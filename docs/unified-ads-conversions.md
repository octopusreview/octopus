# Unified Ads business events

The hosted Octopus backend can send registrations, successful cash payments and
successful individual refunds to `https://ads.weezboo.com/api/conversion-events`.
Delivery is disabled by default and refused on self-hosted installations.
Business-event delivery uses only a backend key and does not alter Stripe charge
parameters or forward sales to ad networks. Optional visitor collection and
checkout associations are described in [visitor and sales attribution](unified-ads-tracking.md).

## Source facts and money

| Signal | Committed source | Event meaning |
| --- | --- | --- |
| Registration | `User.id` and `createdAt` | A new product user, not a login, organisation or completed onboarding |
| Purchase | Stripe-linked purchase, subscription or auto-reload credit transaction | Verify the succeeded PaymentIntent and automatically captured Charge; report `amount_received` in the original GBP/USD minor units |
| Refund | Any credit transaction with an individual `stripeRefundId`, including existing `usage` rows | Verify that refund succeeded and matches its original charge; report its own amount, never the cumulative refunded balance |

Stripe Checkout and PaymentIntent aliases normalize to the same hashed payment
identity and charge timestamp. Source metadata must agree with the retained
billing organisation. Payment and refund IDs, organisation IDs and user IDs are
hashed before delivery; no name, email, processor object, URL or click ID is sent.
The registration's customer is not inferred later from current membership.

Credit allocation is not cash: a plan granting 169 credits after a $148 charge
reports `amountMinor: "14800"`, not `16900`. Free grants and ordinary usage have
no purchase event. Declined or pending payments are not revenue. GBP and USD
remain separate; unsupported currencies or inconsistent processor facts are held.

Checkout `subscription_start` is `subscription_initial`; credit purchases are
`top_up`, and auto-reloads are `auto_reload`. Existing off-session `subscription`
metadata does not identify initial versus renewal charges, so those payments use
`other_sale`. The collector does not guess from mutable plan state or change
Stripe charge metadata. Manual capture is held because the current normalizer
uses the automatic charge creation timestamp.

For webhook-to-ledger processing and its activation boundary, see the
[refund completion lifecycle](integrations/refund-completion.md).

## Durable delivery

The existing engine schedules `marketing-conversions` every minute when enabled.
Each sweep captures at most 100 registrations and 100 financial rows using an
indexed anti-join against the source's outbox. Repeated sweeps revisit retained
facts, so an older transaction that commits late is not lost behind a timestamp
cursor. The partial financial index excludes ordinary usage. Result size is
bounded; query work still grows with retained eligible history and must be
measured before expanding scale.

Concurrent workers claim rows using PostgreSQL `SKIP LOCKED` and 120-second
leases. A tick processes at most 20 rows and checks its 90-second time budget
between rows. Each Stripe read has a 10-second timeout; receiver identity checks,
event delivery and response-body reading share one 10-second deadline per
attempt. Expired workers cannot acknowledge a successor's lease.

At each claim, eligible business events take priority over tracking records,
even older tracking retries. Tracking uses only the remaining shared batch and
time budget, so a sustained business backlog can delay tracking. Tracking that
is disabled or fails local configuration validation is excluded from claims
without changing saved bytes or attempts. See [visitor and sales attribution](unified-ads-tracking.md)
for its separate configuration and capture gates.

The serialized body is committed before the first receiver HTTP request. Database
constraints preserve source identity and those exact bytes across retries,
worker restarts and key rotation. Before every event POST, the producer calls
`GET /api/conversion-events/identity` using the same bearer key as that POST,
without caching or following redirects. It requires a `200` response with
`schemaVersion: 1`, the configured source ID and environment, a UUID `keyId`, and
all three capabilities: `registrations`, `purchases`, `refunds`. A mismatched,
malformed or unavailable identity leaves the row pending with backoff and no
event POST or acknowledgement. Inspect `receiver_identity_invalid` or
`receiver_identity_http_<status>` when diagnosing these failures.

A lost response retries the same event; only a valid committed `201` receipt or
matching `200` duplicate receipt acknowledges it. Network errors, malformed
success, and event POST `401`, `408`, `429` and server errors retry with bounded
exponential backoff. `Retry-After` is respected up to 24 hours.
Other event POST rejections, including event conflict `409`, are held as `blocked`.
Delivery never charges, refunds or grants credits.

Stripe credentials are needed only to resolve a financial row that has no saved
payload. Registrations and retries of persisted bodies can deliver without
`STRIPE_SECRET_KEY`; unresolved financial rows remain pending with
`source_unavailable` until processor access is restored.

A refund also retains its actual original payment as an outbox dependency when
needed. Either can arrive first; the receiver owns reconciliation. The receiver
admits new events up to 90 days old. An older original can therefore remain held,
and refund/net totals may remain unavailable; no substitute payment is invented.

## Configuration and activation

1. Apply `20260915140000_marketing_conversion_outbox` through the usual fresh
   backup, migration and application deployment gates. It adds the outbox, source
   indexes and an immutable-payload trigger. It does not change billing tables'
   write behavior. Index creation needs normal release-owner lock/size review.
2. The Unified Ads owner creates dedicated TEST and LIVE sources with capabilities
   `registrations`, `purchases`, `refunds`, and no credit unit. Source capabilities,
   origin and environment are immutable. Put each one-time server key directly
   into its environment's backend secret store. Never paste it into a terminal
   argument, log, browser bundle, issue or evidence file.
3. Validate synthetic events and duplicate delivery only against TEST, from an
   isolated test database and Stripe test fixtures/account. The production
   scheduled worker refuses TEST configuration. Verify receiver receipts and
   producer outbox acknowledgement before LIVE activation.
4. Configure `UNIFIED_ADS_SOURCE_ID`, `UNIFIED_ADS_ENVIRONMENT=live`,
   `UNIFIED_ADS_SERVER_KEY`, and an explicit UTC `UNIFIED_ADS_FROM` capture cutoff.
   Use the actual activation time for new events. A historical cutoff is a
   separately recorded backfill decision, not a default. Finally set
   `UNIFIED_ADS_ENABLED=true` on the hosted engines. All replicas must use the
   same configuration. Source IDs and keys are distinct between TEST and LIVE.
5. Verify genuine business-event receipts and sanitized outbox counts after
   activation. No synthetic LIVE event is a release canary. To rotate a key,
   install the replacement for the same source, verify delivery, then revoke the
   old key. `401` keeps events retryable. Do not recreate event IDs.

Unset or false disables capture/delivery, and engine startup removes a stored
schedule. Configuration errors fail the isolated job rather than a customer's
billing flow. Persisted rows remain available across opt-out/re-enable; changing
the capture cutoff does not rewrite or discard them. Rolling back to the prior
application requires disabling the schedule first; keep the additive migration
and retained outbox evidence.

## Operations and limits

Inspect aggregate outbox `status`, `kind`, `attempts`, `errorCode`, `httpStatus`,
oldest pending timestamp and last delivery timestamp. Logs contain counts only;
the queue's sweep error is sanitized. A `delivered` row means receiver storage,
not ad attribution or successful refund reconciliation. A `blocked` row needs
its source fact/configuration diagnosed before any deliberate retry; never edit
its payload or create a fresh identity to bypass a conflict. Outbox records are
retained for retry deduplication, without automatic deletion in this release.

Stripe refund references support both `re_` and `pyr_`. Both use the same
read-only Refund retrieval and exact object, original-payment, ownership,
currency, amount, timestamp and succeeded-status validation. The full original
refund ID determines the canonical event ID; never rename a `pyr_` reference.
A previously blocked row does not automatically retry after a resolver fix.
For the pre-transport `unsupported_refund_reference` failure only, operators can
use `GET /api/admin/marketing/refunds/{outboxId}/retry` with the existing
`ADMIN_API_SECRET` bearer. This read-only preview revalidates the Stripe refund
and original payment, requires a delivered canonical purchase with matching
payload/organization/environment and receipt, and returns sanitized event facts
plus a `previewHash`. Eligible rows must have a ledger origin, at least one prior
attempt and a source timestamp within the configured capture window. The preview
rejects other failure states, leases, persisted payloads, prior receipts or HTTP
results, foreign sources and ambiguous duplicate refund rows. Its hash binds the
row and cash facts, selected original purchase and receipt, and runtime source,
environment, server key and capture cutoff without exposing the key.

Production recovery remains **held** until the exact candidate has been reviewed,
tested and deployed. Send a sanitized GET preview to the receiver owner for a
refreshed zero-duplicate baseline and coordinated approval of that single row.
Only after that approval, send `POST` to the same route with **only**
`{"previewHash":"<value from GET>"}`.
The handler repeats the read-only validation and rejects changed facts, runtime
binding or row state. A serializable compare-and-set saves the verified refund
bytes and marks only that blocked row pending, retaining its identity and attempt
count. The normal worker delivers it; the operator route sends no event and
performs no billing action. A repeated or concurrent retry cannot requeue it
again. If a response is lost, inspect the existing row and receiver receipt;
do not initiate another financial refund or edit the database.

Refund processing reuses and verifies an already delivered canonical original
purchase even when its origin is a ledger row. Equivalent ledger and payment
aliases are accepted only when every candidate has the exact canonical payload,
matching organization and environment, the same valid receipt ID, a delivery
timestamp and HTTP status `200` or `201`. The first row in ascending ID order
binds the preview. Any conflicting candidate or overflow of the bounded alias
lookup rejects processing with `original_payment_conflict`.
The verified purchase is not enqueued again. Recovery requires this existing
delivery; it never manufactures a missing purchase dependency. A pending status
is not delivery acceptance; synthetic tests do not establish LIVE acceptance.

Capture depends on retained users and the billing ledger. Deletion before the
next capture can remove a source fact; a successful processor payment missing
its billing ledger remains unobserved by capture until normal billing reconciliation
records it. The outbox is not a complete independent Stripe accounting ledger. Since
the owner's decision of 15 November 2026 a period can still be declared complete
to the receiver from the billing ledger alone; see the
[complete-period declaration](integrations/retained-cash-observations.md#complete-period-declaration)
for what that statement does not cover. For bounded operator inspection and receiver
comparison, see [retained cash observations](integrations/retained-cash-observations.md).
For the separate audit and explicitly invoked transport candidate, see the
[isolated upstream cash audit](integrations/upstream-cash-audit.md).
Alerts remain a follow-up.

Business events report observed registrations, gross payments and individual
refunds; they are not forwarded to Google, Reddit, Meta or X. Business events
alone do not establish campaign attribution. The separate
[visitor and sales attribution integration](unified-ads-tracking.md) supplies
consented context. Signup-to-paid cohorts, ROI, completed onboarding and credit
balances are not established by this business-event contract.

## Validation

Run the cash/transport unit tests and the real PostgreSQL outbox tests:

```sh
bun test apps/web/lib/__tests__/marketing-conversions.test.ts apps/web/lib/__tests__/marketing-stripe.test.ts
RUN_MARKETING_DB_TESTS=1 bun test apps/web/lib/__tests__/marketing-outbox.db.test.ts
```

The database suite requires `DATABASE_URL` pointing to a local dedicated database
whose name includes `test` as a hyphen- or underscore-delimited segment (or is
exactly `test`). It creates and deletes only a uniquely named sibling
test database, using the actual migration and production Prisma/outbox functions.
The database user needs test-database creation privileges. Stripe and HTTP
fixtures are synthetic; no live payment or advertising credentials are used.
The `pg`/`@types/pg` test dependencies reuse versions already in the lockfile and
permit independent transactions for commit-order, lease and migration proofs.
