# Retained cash observations (operator candidate)

This additive inspection feature records what the retained credit ledger and cash outbox support at one producer database snapshot. It never calls Stripe, capture, resolution, retry or dispatch to fill missing facts. A migration is required: `20260922140000_marketing_cash_observations`. Deployment, migration rollout and any real observation require separate operational coordination. The snapshot, read and compare operations start no scheduled job; the [complete-period declaration](#complete-period-declaration) has its own daily job, off by default.

## Setup expectation

Keep the existing [hosted business-event configuration](../unified-ads-conversions.md#configuration-and-activation). Every operation, including `read`, requires enabled delivery configuration and a valid server-only `UNIFIED_ADS_CASH_EXPECTED_BINDING`. Production refuses TEST configuration. Supply the binding as JSON with exact keys:

```
{sourceId, environment, keyId, capabilities, project: {projectId, version}}
```

Values must come from independently retained owner setup, not comparison output. Project ID is a UUID, version a positive integer, capabilities the exact configured set including purchases/refunds. No default project/version exists. TEST needs its own expectation, never a LIVE binding. The key ID must match the configured source key; no key secret is placed in the expectation or observation. Changed binding blocks comparison. This configuration is not added automatically by deployment.

## Operator operations

The existing `ADMIN_API_SECRET` bearer authorization protects `POST /api/admin/marketing/cash-observations`. JSON only, no query, bounded 2KiB body, no-store responses. Exact request variants:

- `{"operation":"snapshot","from":"2026-09-20T00:00:00.000Z","to":"2026-09-21T00:00:00.000Z","predecessor":null}`: create one inventory. Interval is half-open, requires `from < to`, and cannot end in the future. Both timestamps must use UTC with exactly three fractional digits, as shown. A predecessor inventory must have identical binding, activation and interval; the new document references its digest, never rewrites it.
- `{"operation":"read","id":"observation UUID"}`: read a source/environment-scoped immutable observation.
- `{"operation":"compare","id":"inventory UUID"}`: compare declared canonical members, then append comparison evidence linked to that exact inventory digest. It cannot repair an outbox row, ingest/replay an event or change a credit balance.

- `{"operation":"reconcile","from":"2026-09-20T00:00:00.000Z","to":"2026-09-21T00:00:00.000Z"}`: declare that period complete to the receiver, or store why it was not declared. See [complete-period declaration](#complete-period-declaration).

Identifiers in examples are illustrative, not authorization to make real calls. Operator responses include internal retained ledger/outbox provenance: keep them private. Errors are generic, without payloads/credentials/provider diagnostics.

Inventory is persisted inside the same repeatable-read transaction as its data reads. It includes at most 1,000 eligible ledger facts, 1,000 post-activation outbox rows and 1,000 exact-original candidates. Limit+1 probes flag truncation; truncated evidence is incomplete. Documents above 4MiB are rejected rather than silently shortened. Ledger eligibility is shared with normal capture: createdAt at/after existing activation, with an individual refund reference or a purchase/auto_reload/subscription type plus Stripe payment reference. No advance cursor is introduced. All eligible retained facts are inspected so unresolved business times cannot disappear through an interval filter.

Valid persisted original bytes yield normalized semantic projections; raw bytes remain unchanged. Equal canonical CS/PI aliases retain their origins but count once. Content/receipt/scope conflicts, missing capture, null/invalid payloads, unsupported references, unaccounted retained origins, pending/processing/blocked delivery and missing exact originals keep the scoped result incomplete. Cash occurredAt, ledger/outbox creation, producer observation and receiver batch intervals remain distinct. Current state is retained, not reconstructed attempt history. A pending row can have an uncertain receiver acknowledgment; no absence inference is made.

A genuine eligible in-range refund can require its exact original payment before activation. It remains an explicitly tagged dependency at its original timestamp, not new-period revenue and not permission to sweep old payments. Retained credit ledger coverage is not processor coverage; deletion or unsupported upstream paths cannot be recovered by this feature. Aggregate refund accounting/net revenue remains receiver-owned and is not certified by receipt matches.

## Results

- A: `not_observed`, `no_declared_members`, `declared_members_matched`, or `incomplete`. Comparison uses batches of at most 32 with same-key identity preflight each time, fixed HTTPS destination, no redirects/Origin/Cookie and strict ordered responses/project binding. It retains actual request/response digests and separate receiver intervals. There is no atomic whole-set receiver snapshot.
- B: `complete_retained_scope` only when the bounded retained snapshot has no accounting gaps; otherwise `incomplete`. An all-matched declared set can coexist with incomplete B. It is not a claim of all cash ever collected.
- C: always `unknown` for upstream completeness. The complete-period declaration below does not change this: it is made from the ledger, not from the processor.

The snapshot and comparison emit no customer-zero label, advertising assignment, learning eligibility or model admission. The complete-period declaration is different: the receiver may use it as described below. Empty declared membership is not positive A. A lost-ACK match is evidence only: pending outbox status is unchanged. Late facts require a successor inventory; old results remain historical observations and must not be used as current completeness after contrary evidence. Comparison documents are append-only; later comparisons do not edit prior ones. The database rejects observation UPDATE/DELETE; this is not a guarantee against database-owner privilege or retention loss outside the supported application.

## Complete-period declaration

Since the owner's decision of 15 November 2026, Octopus may tell the receiver that a period is complete: the purchases and refunds it declares for `[from, to)` are every one it has for that source. Octopus makes this statement from its own billing ledger, without a check against Stripe. The receiver compares both directions and saves a reconciliation only when the two sets agree. It may then read "no sale recorded" in that period as "no sale", so read [what it does not cover](#what-the-declaration-does-not-cover) before enabling it.

The declaration is version 2 of the receipt comparison (`schemaVersion: 2`, `complete: true`), sent to the same fixed destination with the same source key, expected binding and identity check as a version 1 comparison. One identity check and at most one POST are made. Nothing is retried, and billing, the ledger, the outbox and credit balances are only read.

### When a period is declared

All of these must hold, or nothing is sent:

- The period starts at or after activation (`UNIFIED_ADS_FROM`), has ended and covers at most 92 days. Both timestamps are UTC with three fractional digits.
- Every eligible ledger fact since activation has an outbox row.
- Every purchase and refund outbox row since activation is delivered. One pending, leased or blocked row refuses every period, because the time of an undelivered event may be unknown. A blocked row keeps refusing until it is dealt with.
- The delivered rows read as events: valid saved bytes, one environment, and equal content and receipt for the aliases of one payment.
- At most 1,000 events fall inside the period.

The declared set is each delivered purchase and refund whose event time is inside the period, once per event however many ledger or payment aliases it has. Identifier, amount, currency and time come from the saved bytes that were delivered, through the same normalizer the snapshot uses. An original payment outside the period is not declared, even when its refund is inside.

### What the declaration does not cover

- A payment Stripe took that never reached the billing ledger. No processor inventory is read; C stays `unknown`.
- A ledger row deleted, for example with its organisation, before capture saw it.
- Payments in an unsupported currency or with manual capture. They are never delivered: the row stays blocked, and while it does no period is declared.
- Anything before activation.
- A refund that completes later. The `refund.updated` subscription is [absent and held](refund-completion.md#isolated-readiness-only), so such a refund may never reach the ledger.
- Attribution, net revenue and refund accounting, which remain the receiver's.

An agreeing result shows that the receiver holds what Octopus declared. It does not show that the ledger itself is complete.

### Outcomes

Every result has one `outcome` code. A period refused before any read is returned and not stored. Every other result is appended as an immutable observation of kind `comparison` with no parent, which the `read` operation returns.

| Outcome | Sent | Meaning |
| --- | --- | --- |
| `period_invalid`, `period_before_activation`, `period_in_future`, `period_too_long` | no | The period is refused; not stored |
| `ledger_fact_not_captured` | no | An eligible ledger fact has no outbox row yet |
| `delivery_pending` | no | A purchase or refund row is pending or leased |
| `delivery_blocked` | no | A purchase or refund row is blocked |
| `payload_invalid`, `alias_conflict`, `source_conflict` | no | Delivered rows cannot be read as one event each |
| `too_many_entries` | no | More than 1,000 events; `fitsFrom` is the earliest start that fits |
| `body_too_large` | no | The request would exceed the receiver's byte limit |
| `receiver_identity_unavailable`, `receiver_identity_mismatch` | no | The receiver did not identify as the expected source and key |
| `agreed` | yes | The receiver saved the reconciliation; `reconciliationId` names it |
| `disagreed` | yes | The sets differ; `receiver.notReceived.count` and `receiver.notDeclared` give the counts. Nothing was saved |
| `receiver_<code>` | yes | The receiver refused with that error code in lower case, for example `receiver_receipt_set_too_large` |
| `receiver_http_<status>` | yes | Any other HTTP status |
| `receiver_reply_invalid`, `receiver_unavailable` | yes | No usable answer. The receiver may have saved a reconciliation; it is not asked again |

The scheduled job can also report `disabled`, `production_requires_live_source` and `binding_invalid` without reading anything.

The stored document holds the period, `requestedFrom`, the outcome, the declared counts, SHA-256 digests of the request and reply bytes, the receiver's status and `reconciliationId`, the count of undelivered rows by status and whether a ledger fact was not captured. It holds no event, customer or key.

### Operator and schedule

`{"operation":"reconcile","from":"...","to":"..."}` on the operator route declares one period. It answers `201` with the stored observation, or `400` with `{"error":"Period refused","reason":"..."}` for a refused period.

The daily job `marketing-reconciliation` runs at 05:30 UTC on engine replicas when `UNIFIED_ADS_ENABLED=true` and `UNIFIED_ADS_RECONCILIATION_ENABLED=true` on the hosted application. Unset or false removes a stored schedule at engine startup, and the worker rechecks the flag. It needs `UNIFIED_ADS_CASH_EXPECTED_BINDING`. A failed run is not repeated; the next day's run replaces it.

The job declares one trailing window. `to` is the run time minus two hours, so a sale still being delivered does not make the result stale at once. `from` is the later of activation and `to` minus 92 days. When that window holds more than 1,000 events, `from` moves forward to the first instant from which 1,000 or fewer fit; the refusal and the shorter declaration are both stored, and the second keeps the wider start in `requestedFrom`. A purchase or refund that arrives later for a declared period makes the receiver's saved reconciliation stale, and the next run sends a newer one.

Before a first LIVE run: apply `20260922140000_marketing_cash_observations`, set the binding from independently retained owner setup, and accept the declaration against a TEST source. Enabling the flag is a separate, coordinated step.

## Validation and limits

The immutable [receiver vector packet](../../apps/web/lib/__tests__/fixtures/marketing-cash-vectors.json) owns the frozen normalization examples and source-contract digest; the [normalization tests](../../apps/web/lib/__tests__/marketing-cash-observation.test.ts) exercise every valid projection and rejection. Isolated PostgreSQL tests run normal capture/dispatch then the real snapshot/persistence path, check successor/immutability, and distinguish all-matched A from missing-capture B. Comparison transport injections are component evidence only. Full new retained-inventory → isolated actual receiver acceptance requires a newly coordinated receiver-owned fixture; prior destroyed protocol fixtures are not reused.

Run pure tests with `bun test apps/web/lib/__tests__/marketing-cash-observation.test.ts apps/web/lib/__tests__/marketing-cash-reconcile.test.ts`. The second file freezes the declaration's request bytes and every reply it accepts or refuses; the database suite runs the declaration after real capture and dispatch. For DB test commands and dedicated local database requirements, see [business-event validation](../unified-ads-conversions.md#validation). No LIVE/provider access is needed or permitted for candidate validation.
