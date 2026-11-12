# Draining the job queue for a release

A drain stops every queue worker from claiming new jobs, cluster-wide, so that a release can replace the workers without interrupting a review or an indexing run. Jobs that arrive during a drain are accepted and stay queued. Nothing is cancelled.

The drain state lives in PostgreSQL. Every process that starts the queue, web and review worker alike, registers itself and reads the state every 3 seconds. A worker that sees a drain stops fetching on all its queues, lets the jobs it is running finish, and only then acknowledges the drain. A drain is *quiescent* when every live instance has acknowledged it and no work is in flight.

## What a drain guarantees, and what it does not

- No worker that has acknowledged the drain holds or claims a job until claiming is resumed. A worker started during a drain claims nothing.
- Jobs enqueued during a drain stay queued until claiming resumes.
- A job still running at the deadline is **not** cancelled. A drain that has not gone quiescent by its deadline ends as `timed_out` and workers go back to claiming. Stopping the worker anyway interrupts that job, exactly as it did before this feature.
- The deadline bounds only the wait. Once a `GET` has reported `quiescent`, the drain runs until it is resumed or its lease passes, however long the release takes.
- A job whose worker dies stays `active` until its queue timeout passes. pg-boss can then retry it, subject to its retry limit. The drain does not shorten that wait.
- Reviews that run inside a web request (CLI and GitHub Action reviews) and detached indexing or analysis started from a request keep being served during a drain. They are counted, and a drain is not quiescent while any is running. A process that receives SIGTERM waits up to five minutes for its own to finish.
- If the caller that requested the drain disappears, the drain ends by itself when its lease passes, and workers go back to claiming.
- A worker that was frozen through a drain request and wakes up later refuses the next job it fetches. That failure consumes a retry; a job on its last attempt fails without running. The `pull-ollama-model` queue is exempt from this backstop because it has no retries.

## Requirements

- **Apply the migration first.** `20261111130000_queue_drain_state` adds the `queue_drain` and `queue_worker_instances` tables. Apply it before any instance on this version starts. A worker that cannot read the drain state does not register its workers; it logs `[queue] Drain poll failed` and tries again every 3 seconds.
- **Every running worker must be on a version that has this feature.** Workers on earlier versions neither register nor honour a drain: they keep claiming, and the status does not list them. The first release that ships this feature therefore still has to use the previous procedure. Use a drain from the following release on.
- **`ADMIN_API_SECRET` must be set.** Without it the endpoint answers 401 to everything.

Self-hosted single-container installs need the migration and nothing else. With no drain requested, workers behave as before. The endpoint is unusable unless you set `ADMIN_API_SECRET`.

## Endpoint

`/api/admin/queue-drain`, on any instance. Send `Authorization: Bearer $ADMIN_API_SECRET`. A missing or wrong secret gets `401 {"error":"Unauthorized"}`. Responses are JSON and are never cached.

### `GET`: status

Returns the status object described below.

`GET` is not free of side effects: while a drain is running and its lease has not passed, each `GET` renews the lease for another 120 seconds. Poll every few seconds to keep a drain alive; stop polling to let it expire. A `GET` also records the first time the drain is quiescent, and ends a drain whose lease or deadline has passed. It does not revive a lease that has already passed, and writes nothing when no drain is running.

### `POST {"action":"drain"}`: request a drain

| Field | Required | Values |
|---|---|---|
| `requestedBy` | yes | 1 to 100 printable ASCII characters. Stored with the drain. |
| `deadlineSeconds` | no | integer, 60 to 3600. Default 1200. |
| `leaseSeconds` | no | integer, 30 to 600. Default 120. |

Returns `{"generation": <number>, "status": {...}}`. Requesting a drain while one is running returns the same generation and renews the lease; the deadline and `requestedBy` of the running drain are kept.

### `POST {"action":"resume"}`: resume claiming

| Field | Required | Values |
|---|---|---|
| `generation` | yes | the generation returned by the drain request |
| `reason` | no | 1 to 100 printable ASCII characters, not `lease_expired` or `timed_out`. Default `requested`. |

Returns `{"resumed": <boolean>, "status": {...}}`. `resumed` is `false`, with HTTP 200, when the generation is not the running drain's: it is stale, or claiming has already resumed. Nothing changes in that case.

### Errors

- `400 {"error":"Invalid request"}`: body is not a JSON object, the action is unknown, or a field is missing, of the wrong type or out of range. The input is not echoed back.
- `503 {"error":"Queue drain unavailable"}`: the database could not be reached. Nothing is known to have changed; read the status again.

## Status fields

| Field | Meaning |
|---|---|
| `state` | `claiming` (normal) or `draining`. |
| `generation` | Counts drains. Increases by one each time a drain starts. |
| `deadlineAt` | When the running drain ends as `timed_out` if it has not gone quiescent. |
| `leaseUntil` | When the running drain ends by itself unless renewed. |
| `instances` | Processes that have reported in the last hour: `serverId`, `version`, `workersEnabled`, `live`, `acked`, `inlineActive`, `retiring`. |
| `instances[].live` | Reported within the last 9 seconds and not shutting down. |
| `instances[].acked` | Has acknowledged the current generation, which a worker does only after its running jobs have finished. |
| `instances[].retiring` | Has received a shutdown signal. It is no longer counted as live and will not claim again; its in-request work is still counted until it finishes. |
| `activeClaims` | Jobs a worker currently holds, as `{queue, count}` per queue. |
| `inlineActive` | In-request work in flight, summed over instances that reported within the last 9 seconds. |
| `pendingDeliveries` | Review results currently being posted to a provider. |
| `orphanedClaims` | During a drain, the number of held jobs when no live worker is left that has not acknowledged. These jobs may belong to a worker that died or is not reporting, or to an acknowledged worker still finishing. They block quiescence until they finish or expire. |
| `quiescent` | `true` only while draining, when every live instance has acknowledged and `activeClaims`, `inlineActive` and `pendingDeliveries` are all empty or zero. |
| `outcome` | See below. |

## Outcomes

| `outcome` | Meaning | What to do |
|---|---|---|
| `null` | No drain is running. | Nothing. |
| `draining` | A drain is running and work is still in flight, or an instance has not acknowledged yet. | Keep polling. |
| `quiescent` | The drain is running, its lease is valid, and nothing is in flight. | Proceed with the release. Keep polling until you resume. |
| `timed_out` | The deadline passed before the drain went quiescent. Nothing was cancelled. Workers have resumed claiming, or are about to. | Stop the release. Look at `activeClaims`, `orphanedClaims` and the instances that have not acknowledged to see what was still running. |
| `lease_expired` | The lease passed. Workers have resumed claiming, or are about to. | Treat the drain as over. Do not continue the release on it; request a new drain. |

Decide on `outcome`. In-request work is never refused, so some can start after a drain is quiescent; the process that runs it waits for it on shutdown.

## Release sequence

1. Request a drain and keep the `generation` from the response.
2. Poll `GET` every few seconds until `outcome` is `quiescent`.
3. If `outcome` becomes `timed_out` or `lease_expired`, resume with your generation and stop the release.
4. While still draining and still polling, apply migrations and update the services. Replacement workers start, acknowledge the drain and claim nothing.
5. Confirm from `instances` that every live instance reports the new version and that `outcome` is still `quiescent`.
6. Resume with your generation. Queued jobs are picked up by the new workers.

Always resume when the release fails or is cancelled, at any step. Resuming with your own generation is safe to repeat.

## Examples

Request a drain:

```sh
curl -sS -X POST https://octopus.example.com/api/admin/queue-drain \
  -H "Authorization: Bearer $ADMIN_API_SECRET" -H "Content-Type: application/json" \
  -d '{"action":"drain","requestedBy":"release 9.9.9","deadlineSeconds":1200}'
```

```json
{
  "generation": 7,
  "status": {
    "state": "draining",
    "generation": 7,
    "deadlineAt": "2030-01-01T10:20:00.000Z",
    "leaseUntil": "2030-01-01T10:02:00.000Z",
    "instances": [
      { "serverId": "example-engine-1", "version": "9.9.8", "workersEnabled": true, "inlineActive": 0, "retiring": false, "live": true, "acked": false },
      { "serverId": "example-web-1", "version": "9.9.8", "workersEnabled": false, "inlineActive": 1, "retiring": false, "live": true, "acked": false }
    ],
    "activeClaims": [{ "queue": "process-review", "count": 2 }],
    "inlineActive": 1,
    "pendingDeliveries": 0,
    "orphanedClaims": 0,
    "quiescent": false,
    "outcome": "draining"
  }
}
```

Read the status (and renew the lease):

```sh
curl -sS https://octopus.example.com/api/admin/queue-drain -H "Authorization: Bearer $ADMIN_API_SECRET"
```

```json
{
  "state": "draining",
  "generation": 7,
  "deadlineAt": "2030-01-01T10:20:00.000Z",
  "leaseUntil": "2030-01-01T10:05:30.000Z",
  "instances": [
    { "serverId": "example-engine-1", "version": "9.9.8", "workersEnabled": true, "inlineActive": 0, "retiring": false, "live": true, "acked": true },
    { "serverId": "example-web-1", "version": "9.9.8", "workersEnabled": false, "inlineActive": 0, "retiring": false, "live": true, "acked": true }
  ],
  "activeClaims": [],
  "inlineActive": 0,
  "pendingDeliveries": 0,
  "orphanedClaims": 0,
  "quiescent": true,
  "outcome": "quiescent"
}
```

Resume:

```sh
curl -sS -X POST https://octopus.example.com/api/admin/queue-drain \
  -H "Authorization: Bearer $ADMIN_API_SECRET" -H "Content-Type: application/json" \
  -d '{"action":"resume","generation":7,"reason":"release 9.9.9 done"}'
```

```json
{
  "resumed": true,
  "status": {
    "state": "claiming",
    "generation": 7,
    "deadlineAt": "2030-01-01T10:20:00.000Z",
    "leaseUntil": "2030-01-01T10:07:10.000Z",
    "instances": [
      { "serverId": "example-engine-1", "version": "9.9.9", "workersEnabled": true, "inlineActive": 0, "retiring": false, "live": true, "acked": true },
      { "serverId": "example-web-1", "version": "9.9.9", "workersEnabled": false, "inlineActive": 0, "retiring": false, "live": true, "acked": true }
    ],
    "activeClaims": [],
    "inlineActive": 0,
    "pendingDeliveries": 0,
    "orphanedClaims": 0,
    "quiescent": false,
    "outcome": null
  }
}
```

## Recovering a stuck drain

Workers that stay idle with `state` still `draining` mean a drain was requested and neither resumed nor allowed to expire, usually because something keeps polling `GET`.

1. `GET` the status and note `generation`.
2. `POST {"action":"resume","generation":<that generation>}`. `resumed: true` means workers start claiming within a few seconds.
3. If you cannot reach the endpoint, stop whatever is polling it. The drain ends by itself when `leaseUntil` passes: 120 seconds after the last `GET`, or at most 10 minutes after the last drain request.

A job listed under `orphanedClaims` may still be finishing. If its worker died, pg-boss handles it after its queue timeout (15 minutes for an ordinary review, 30 minutes for large reviews, indexing and community reviews by default), subject to its retry limit.
