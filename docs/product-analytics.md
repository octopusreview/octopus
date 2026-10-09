# Product analytics: first funnel

Delivery tracker: [#921](https://github.com/octopusreview/octopus/issues/921).
Definitions: [#922](https://github.com/octopusreview/octopus/issues/922).
Access: [#923](https://github.com/octopusreview/octopus/issues/923).

## Definition v1

The unit is an **organisation**, not a user, repository or review attempt.
An invited member joining an existing organisation does not start a new cohort.
Use UTC throughout. A cohort begins at organisation creation; weekly cohorts
start on Monday. Account registration remains a separate acquisition metric.

**Activation** means the first substantive PR/MR review successfully published
for an eligible customer organisation. A review with no findings counts. An empty
diff, policy-skipped assessment, failed or cancelled job does not. For v1, require
complete eligible-input coverage and a completed assessment; report partial
reviews separately. Publishing a review does not prove someone viewed it.

The historical baseline cannot yet calculate that definition reliably. It uses
`first_publication_recorded_at`, labelled **publication observed**, and leaves
`substantive_activation_at` unknown. The existing marker includes empty/skipped
assessments and was introduced after some customers joined. A missing marker
does not establish that no review was ever published. Never report the proxy as
the activation rate. [#924](https://github.com/octopusreview/octopus/issues/924)
tracks milestone repair and evidence-based backfill.

## First dashboard

| Measure | Definition and denominator |
| --- | --- |
| Provisional organisations | Standard organisations not currently banned or soft-deleted; count once by opaque organisation ID. |
| Repository connected, observed | Earliest retained repository creation at or after organisation creation. Import time is a setup proxy, not OAuth completion time. |
| Publication observed | Earliest retained PR first-publication marker at or after organisation creation. Missing historical records remain a coverage gap. |
| Publication within 7 days, observed | Observed publications before cohort start + 7 days, divided by organisations at least 7 days old at the observation cutoff. |
| Time to publication, observed | Median and p90 hours from organisation creation, among organisations with an observed publication; not a statistic for non-converters. |
| Paid, observed | At least one retained, validated positive cash purchase event, deduplicated by canonical event ID. Credit grants, coupons and opening checkout do not count. |
| Payment order | Payments observed before versus after publication. Payment is not forced to be the last step in a linear funnel. |
| Activated-to-paid, target | Once strict activation is available, first positive payment within 30 days after activation, among organisations with no earlier payment and a full 30-day observation window. Already-paid organisations are a separate segment. |
| Paid retention, target | Distinct paying organisations with a substantive published review in each complete 7-day period after first payment, divided by the paid cohort old enough to reach that period. Rereviews are activity, not new activations. |

The provisional cohort still needs internal/test/seeded-account exclusions and
historical provenance. Current ban/deletion flags can change cohort membership;
they are not an immutable historical eligibility decision. Document exclusions
and their effective dates before treating this as a customer conversion KPI.
Do not infer abuse merely from low use or a high risk score.

Provider connection, indexing and review requests are diagnostic steps. Indexing
is not a mandatory predecessor on every supported path. `latest_index_at` is
the latest stored index time, never the first. Deleted repositories and PRs can
remove historical observations, so source retention limits must accompany charts.

The initial cash projection covers only retained LIVE conversion events with
delivery receipts. That is a lower bound on historical payments, not processor
completeness. Missing payloads, missing organisation links and conflicting event
identities need reconciliation. Keep currencies separate. Refunds are separate
events; gross conversion and retained revenue answer different questions.

## Restricted source dataset

`scripts/analytics/access.sql` installs four security-barrier views and a
dedicated `octopus_analytics_reader` role in one transaction. The views export
opaque namespaced identifiers, bounded states, timestamps and validated cash
fields. They exclude credentials, names, emails, IPs, PR titles/URLs, source
content, full audit metadata and payment-provider objects.

| View | Primary identifier | Purpose |
| --- | --- | --- |
| `octopus_analytics.organizations_v1` | `organization_id` | Organisation cohort and current eligibility flags. |
| `octopus_analytics.repositories_v1` | `repository_id` | Provider, repository setup and latest index state. |
| `octopus_analytics.review_milestones_v1` | `pull_request_id` | First recorded PR/publication; strict activation explicitly unknown. |
| `octopus_analytics.cash_events_v1` | `event_id` | Deduplicated observed purchases/refunds with integer minor-unit amount and currency. |

Rows from different source configurations with identical cash event IDs and
facts collapse to one. Conflicting facts for the same event ID are excluded
rather than selected arbitrarily. Reconcile excluded counts during ingestion.

The installer refuses an existing role/schema and unsafe inherited PUBLIC
privileges; it never changes other principals' grants. It grants SELECT only on
these four views, no future-object privileges. The role starts **NOLOGIN**, with
no password, a two-connection limit and bounded query/idle timeouts. Read-only
defaults supplement the actual privilege restrictions; they are not the access
control themselves. PostgreSQL system metadata and permitted temporary objects
are outside the business-table allowlist.

## Operator setup

1. Confirm the target database, installed PostHog source/view support, private
   reachability, shared-project visibility and current backup. Check existing
   principal/schema collisions before applying anything. No public DB exposure,
   Postgres restart, logical replication or application release is needed by
   this SQL itself.
2. Run `scripts/analytics/check.sh` against the disposable local PostgreSQL
   fixture. Review the SQL through the repository's normal PR gates.
3. Apply the reviewed `access.sql` using the application's existing DB operator
   connection. Record its exact checksum and aggregate acceptance privately.
4. Verify the four projections and deny checks using the restricted role. Then
   generate a unique credential through the existing secret channel and enable
   LOGIN only for the approved connection. Never put a password in shell
   arguments, a committed file, an issue or a handover message. Do not share an
   operator credential with the analytics lead.
5. Configure only this schema and these four views in the existing PostHog
   project. Verify that the actual connector discovers views and can read them
   with these permissions. If it cannot, keep the source unconfigured and choose
   a separately reviewed projection/export path; do not broaden table grants.
6. Start with a bounded full refresh at an agreed off-peak schedule. These views
   do not expose a reliable modification cursor. Verify repeat syncs do not
   duplicate rows and source deletions disappear from the destination. Do not
   use append-only ingestion for mutable current-state projections.
7. Reconcile source/destination counts and a fixed UTC observation window; save
   query links, sync freshness, coverage limits and operational ownership.

Revoke login first with `ALTER ROLE octopus_analytics_reader NOLOGIN`, then
terminate only that role's sessions when immediate revocation is required.
Pause/remove its PostHog source before retiring the views. Remove only the four
named views, schema and principal after checking dependencies; do not use CASCADE.
Rotation changes the dedicated credential and source config, never app DB secrets.

No separate PostHog project or paid group analytics is assumed. Product and
environment properties are filters, not access boundaries. Keep user identities
separate from organisation identity; organisation-level SQL works without merging
all team members into a fake person. The shared platform owner must qualify
edition/worker/connectivity requirements. See [PostHog source guidance](https://posthog.com/docs/data-warehouse/sources/postgres).

## Reproduce the baseline

After access is installed, use the dedicated connection and an explicit cutoff:

```sh
psql service=octopus_analytics -X -v as_of=2026-10-09T00:00:00Z \
  -f scripts/analytics/funnel.sql
```

Configure the service in the operator's protected PostgreSQL service/password
files; never put a password in the connection argument or logs. The query returns weekly aggregates, never
customer rows. Historical figures remain provisional because both eligibility
and retained evidence can change. Store the UTC cutoff and coverage notes with
each exported result. Source SQL is the reconciliation reference; validate the
equivalent PostHog query against the imported view names before saving dashboards.

## Tracking specification for the next PR

Each event has `product=octopus`, `environment`, `schema_version`, a stable event
ID, occurrence time, opaque organisation ID, source (`web`, `cli` or `server`)
and release when known. User identity is separate and optional for background
work. Use one authoritative producer per outcome. Replays reuse the same ID.

| Event | Producer / when | Additional allowlisted properties |
| --- | --- | --- |
| `organization_created` | Server after committed creation | creation method enum, cohort-classification version |
| `provider_connection_started` | Browser/CLI explicit user attempt | provider, attempt ID |
| `provider_connection_completed` / `provider_connection_failed` | Server authoritative result | provider, attempt ID, bounded failure category |
| `repository_enabled` | Server after persisted enablement | repository ID, provider |
| `repository_index_completed` / `repository_index_failed` | Server final result | repository ID, attempt ID, bounded failure category |
| `review_requested` | Server accepted request | PR/repository/attempt IDs, provider |
| `review_published` / `review_failed` | Server confirmed final outcome | PR/repository/attempt IDs, coverage/assessment enums, substantive flag |
| `review_viewed` | Only where an actual view is measurable | PR/repository ID, surface; no claim of views on an external forge |
| `checkout_started` | Browser explicit checkout attempt | attempt ID; never treated as payment |
| `payment_succeeded` / `payment_refunded` | Existing authoritative billing event | canonical opaque event ID, minor-unit amount, currency |

Respect existing analytics permission/consent rules. Keep replay, broad
autocapture, free text and automatic exception capture disabled. This document
does not enable collection. [#925](https://github.com/octopusreview/octopus/issues/925)
owns instrumentation; [#859](https://github.com/octopusreview/octopus/issues/859)
owns existing ad-conversion delivery. A receiver receipt is not evidence of
Google/Meta forwarding or attribution.

## Handover ownership

The application owner provides reviewed projections, initial restricted access,
source reconciliation and the initial metric definitions. The analytics lead
owns the definitions after review, saved queries/dashboards, refresh monitoring,
coverage checks and the first weekly improvement proposal. Repository/agent
access is sufficient to prepare PRs; changes still need the usual tests and
review, and production credentials remain scoped to the job.

First analysis: identify the largest observed drop-off with its cohort size and
coverage limits, propose one explanation and one testable improvement. Track a
primary conversion metric and review-success/error guardrails. Do not attribute
causality to the early purchase prompt before measuring it.
