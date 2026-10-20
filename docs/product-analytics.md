# Product analytics: first funnel

Delivery tracker: [#921](https://github.com/octopusreview/octopus/issues/921).
Definitions: [#922](https://github.com/octopusreview/octopus/issues/922).
Access: [#923](https://github.com/octopusreview/octopus/issues/923).

## Definition v1

The unit is an **organisation**, not a user, repository or review attempt.
An invited member joining an existing organisation does not start a new cohort.
Use UTC throughout. A cohort begins at organisation creation; weekly cohorts
start on Monday. Account registration remains a separate acquisition metric.
The observation cutoff is exclusive: facts exactly at the cutoff are excluded.

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
| Publication within 7 days, observed | Among organisations at least 7 days old at the cutoff, observed publications before organisation creation + 7 days, divided by that same mature cohort. |
| Time to publication, observed | Median and p90 hours from organisation creation, among organisations with an observed publication; not a statistic for non-converters. |
| Paid, observed | At least one retained, validated positive cash purchase event at or after organisation creation and before the observation cutoff, deduplicated by canonical event ID. Credit grants, coupons and opening checkout do not count. |
| Payment order | Earliest observed purchase before versus at/after earliest observed publication, for organisations with both. Paid organisations without a publication remain outside these two counts. Payment is not forced to be the last step in a linear funnel. |
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

### First successful index

`firstIndexedAt` is the earliest known completion of a full, usable repository
index. Re-indexing never moves it forward. `indexedAt` remains the latest stored
index time; neither timestamp is the organisation's activation event.

A full provider index qualifies only after every eligible file has been read and
all resulting chunks have been embedded and stored. Ignore rules, unsupported
files, binary content and configured size limits are intentional exclusions.
File-read failures, truncated inventories, incomplete embeddings, cancelled or
superseded attempts do not qualify. A valid empty snapshot can still support
reviewing a first PR, but does not set this milestone. Incremental updates cannot
establish a first full index: they leave a null `indexedAt` unchanged until a
usable full index completes, and refresh only an existing non-null `indexedAt`.

Full runs and local uploads write to separate generations. Point IDs and every
code-index query or deletion are scoped to that generation. The guarded database
completion transaction activates the generation together with its statistics and
milestones; staged, failed and cancelled runs remain invisible to search. A late
remote mutation after a client timeout can only affect its original generation.
Existing rows start with a null active generation and read only legacy untagged
data until a full replacement completes; there is no backfill.
Incremental updates bind the stable active generation, so
metadata edits and other merges do not invalidate their writes or failure cleanup.
Previous and abandoned generations remain stored; this change adds no cleanup job.
Generated indexes also use a generation-qualified storage repository key, while
search results retain the logical repository ID. Pre-generation binaries only
read and delete the legacy key, so an old worker cannot expose staged chunks or
erase a new index during a rolling upgrade. Older binaries cannot read the new
generations: rollback requires draining generation-aware writers, clearing the
active-generation pointers and marking indexes stale for reindexing, while
preserving `firstIndexedAt`. A binary downgrade alone does not restore fresh
index coverage, especially for repositories with no legacy index.
Queue timeouts persist as failures, while user cancellations return to pending.
Optional status notifications invalidate client data; displays reload persisted
state so a delayed event cannot overwrite a replacement's status.

For local uploads, the server validates ordered batches, unique paths and the
declared file count. The first response returns `uploadId`; send it unchanged
with every later batch to bind the upload to the same attempt. A single batch
also qualifies if it produces a complete, usable index. Older clients remain
supported without `uploadId`, but their unverified multi-batch completion never
establishes a first-index date; any previously recorded date is preserved.
The CLI implementation is maintained separately.

Rows with an earlier `indexedAt` and no `firstIndexedAt` retain an unknown first
date. Do not backfill from the latest date or present null as “never indexed.”
The restricted repository view exports this field as `first_index_at`; importing
the new column into an existing PostHog source requires the operator step below.

## Restricted source dataset

`scripts/analytics/access.sql` installs five security-barrier views and a
dedicated `octopus_analytics_reader` role in one transaction. The views export
opaque namespaced identifiers, bounded states, timestamps and validated cash
fields. They exclude credentials, names, emails, IPs, PR titles/URLs, source
content, full audit metadata and payment-provider objects.

| View | Primary identifier | Purpose |
| --- | --- | --- |
| `octopus_analytics.organizations_v1` | `organization_id` | Organisation cohort and current eligibility flags. |
| `octopus_analytics.repositories_v1` | `repository_id` | Provider, repository setup, latest index state and `first_index_at`. |
| `octopus_analytics.review_milestones_v1` | `pull_request_id` | First recorded PR/publication; strict activation explicitly unknown. |
| `octopus_analytics.organization_signup_method_v1` | `organization_id` | Creator signup method, evidence and independent timing inference. |
| `octopus_analytics.cash_events_v1` | `event_id` | Deduplicated observed purchases/refunds with integer minor-unit amount and currency. |

`first_index_at` is NULL when no first successful index is on record. That
can mean any of these: the repository has had no successful index yet; it
was indexed before recording started on 15 Oct 2026; or its first index
came through an unverified local upload. NULL alone can't tell these apart.

A first successful index is a complete, non-empty, verified full index; see
[PR #934](https://github.com/octopusreview/octopus/pull/934).

Rows from different source configurations with identical cash event IDs and
facts collapse to one. Conflicting facts for the same event ID are excluded
rather than selected arbitrarily. Reconcile excluded counts during ingestion.

The installer refuses an existing role/schema and unsafe inherited PUBLIC
privileges; it never changes other principals' grants. It grants SELECT only on
these five views, no future-object privileges. The role starts **NOLOGIN**, with
no password, a two-connection limit and bounded query/idle timeouts. Read-only
defaults supplement the actual privilege restrictions; they are not the access
control themselves. PostgreSQL system metadata and permitted temporary objects
are outside the business-table allowlist.

### Organisation signup method

`organization_signup_method_v1` has exactly four text columns and one row per
organisation, including deleted organisations:

| Column | Values |
| --- | --- |
| `organization_id` | `octopus:org:` followed by the organisation ID. |
| `signup_method` | `github`, `google`, `microsoft`, `magic_link`, `password`, `magic_link_or_unknown`, `unknown`. |
| `signup_method_evidence` | `recorded`, `inferred`, `no_login_method`, `no_creator`. |
| `signup_method_inferred` | `github`, `google`, `microsoft`, `password`, `magic_link_or_unknown`, `unknown`. |

The creator is the unique owner membership whose `createdAt` equals the
organisation's `createdAt`, including soft-deleted memberships. Only organisations
with NULL, `auto_default` or `user_created` creation source qualify. The two
ordinary creation paths insert the organisation and owner membership together in
one transaction, with both timestamps defaulting to that transaction's `now()`.
No matching owner, multiple matching owners, an excluded creation source or a
missing user gives `unknown` / `no_creator` / `unknown`.

For a creator, take the earliest account timestamp across **all** their accounts,
not just accounts inside a window. A single provider at that earliest timestamp,
created from 0 through 60 seconds after the user, maps `github`, `google`,
`microsoft` directly and `credential` to `password`. Conflicting providers tied
at an eligible earliest timestamp give `signup_method_inferred = unknown`.
Other cases give `magic_link_or_unknown`, including no account, an unsupported
provider, or an earliest account outside the window. Later accounts do not
replace the earliest one. The 60-second window is a heuristic to be validated
against recorded methods, not a guaranteed signup boundary.

An allowlisted `users.signupMethod` always wins for `signup_method` and gives
`recorded` evidence. Otherwise a timing-derived provider gives `inferred` evidence;
all remaining creator cases give `magic_link_or_unknown` and `no_login_method`.
`signup_method_inferred` is calculated independently even when a method is
recorded, so the two columns can be compared without exporting user identifiers.
**`magic_link_or_unknown` is not the same as magic link**: it mixes magic-link
signups with missing or insufficient login evidence. The evidence column describes
method evidence, not certainty of the reconstructed creator.

Creator reconstruction can fail after merges move memberships or demote source
owners. Login methods unlinked or re-linked after signup can make inference wrong
or unknown. Raw providers, user IDs, names, emails and timestamps are never
projected. The organisation ID remains a linkable identifier; this is a restricted
dataset, not an anonymous export.

The membership compound unique index starts with `organizationId` and supports
the creator join; there is no index on account `userId`/`createdAt` in the current
schema. The view aggregates earliest accounts in bulk, avoiding an account scan
per organisation. This change adds no index or migration. Check the synthetic
plan and reassess indexing if the account table grows substantially.

## Operator setup

For the signup-method view on an existing installation, run
`scripts/analytics/update-organization-signup-method.sql` once through the existing
operator connection, then add `octopus_analytics.organization_signup_method_v1`
as a new table in the PostHog source. The update refuses a missing analytics
schema, reader role or `organizations_v1` view. It is safe to repeat and preserves
the view identity, owner, reader grant and security barrier. Fresh installs get
the same definition and grant from `access.sql`.

Needs the same operator step as #939; if analytics view changes move into regular
migrations, both can be converted together.

For the first-index column on an existing installation, run
`scripts/analytics/update-repositories-first-index.sql` once through the existing
operator connection, then refresh the PostHog source schema so `first_index_at`
is imported. The script preserves the existing view grants and refuses a missing
schema or view. It is safe to repeat. Fresh installations use `access.sql` below.

1. Confirm the target database, installed PostHog source/view support, private
   reachability, shared-project visibility and current backup. Check existing
   principal/schema collisions before applying anything. No public DB exposure,
   Postgres restart, logical replication or application release is needed by
   this SQL itself.
2. Run `scripts/analytics/check.sh` against the disposable local PostgreSQL
   fixture. By default it uses the cached pinned PostgreSQL 17 image and never pulls.
   Without Docker, use `ANALYTICS_TEST_BACKEND=local bash scripts/analytics/check.sh`
   with PostgreSQL 17 or newer tools on PATH. This creates and removes a disposable
   socket-only cluster; it never reuses a server or accepts a connection URL.
   It checks signup methods, privileges, cash validation and synthetic funnel
   aggregates at scale. Review the SQL through the repository's normal PR gates.
3. Apply the reviewed `access.sql` using the application's existing DB operator
   connection. Record its exact checksum and aggregate acceptance privately.
4. Verify the five projections and deny checks using the restricted role. Then
   generate a unique credential through the existing secret channel and enable
   LOGIN only for the approved connection. Never put a password in shell
   arguments, a committed file, an issue or a handover message. Do not share an
   operator credential with the analytics lead.
5. Configure only this schema and these five views in the existing PostHog
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
Pause/remove its PostHog source before retiring the views. Remove only the five
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
