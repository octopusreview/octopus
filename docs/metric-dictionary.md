# Metric dictionary

One entry per metric for the organisation-level onboarding and payment funnel (#922). Version 0.1, a draft for review. It sits beside `docs/product-analytics.md`, which holds the metric contract and runbook.

- **Scope of this version:** the shared rules, the metrics measurable today (group A) and the Activation definition. Groups B and C are listed at the end with their status.
- **Versioning:** each entry has its own version. A change in meaning bumps it and is noted in the entry, so an old chart can be read with the definition it used.
- **Status values:** *live* (stable); *provisional* (works today but can shift, for example because eligibility uses current flags); *waiting* (built, not yet queryable); *target* (not measurable yet).
- **Fields per entry:** name, version and status; question; grain; denominator; numerator; time fields; exclusions; unknown and limits; coverage; awkward cases; reference query.

## Shared rules

These apply to every entry, so the entries don't repeat them. Examples use invented organisations (Kestrel Labs, Fernhill Software) and made-up numbers.

1. **Unit:** the organisation, not the user, repository or review. *Example: Lena signs up and Octopus creates Kestrel Labs for her; her colleague Tom later joins Kestrel Labs by invitation. That's one organisation in the cohort, not two.*
2. **Cohort start:** organisation creation (`created_at`).
3. **Time:** UTC throughout. Weeks start on Monday.
4. **Cutoff:** every result names its cutoff, and the cutoff is exclusive. Documented results use a fixed cutoff; weekly saved queries use the most recent Monday 00:00 UTC. *Example: with a cutoff of 26 Oct 00:00 UTC, Kestrel Labs, created 25 Oct 23:59, counts; Fernhill Software, created 26 Oct 00:00, doesn't.*
5. **Within N days:** strict, the event before creation + N days. *Example: Kestrel Labs is created 1 Oct 10:00, so its 7-day window ends 8 Oct 10:00. A first repository at 8 Oct 09:59 counts; one at 8 Oct 10:00 doesn't.*
6. **Mature cohort:** for an N-day window, only organisations created at least N days before the cutoff count in the rate. *Example: cutoff Mon 26 Oct 00:00, 7-day window. Kestrel Labs, created 18 Oct, counts in the rate. Fernhill Software, created 20 Oct, has had only 6 days: its week of 19 Oct keeps its row but isn't in the rate yet.*
7. **Three outcomes:** converted, not converted, unknown. Unknown is never counted as not converted. *Example: Fernhill Software was created before creation source was recorded, so its source is unknown, not "not user-created".*
8. **Not recorded is not zero:** *Example: GitHub Action requests are recorded from the day #952 is live. Earlier weeks show "not recorded", not 0 requests.*
9. **Rates:** always with numerator and denominator; across weeks, add first, then divide. *Example: week 1, 3 of 4 (75%); week 2, 6 of 36 (16.7%). Averaging the rates gives (75 + 16.7) / 2 = 45.8%. The correct pooled rate is (3 + 6) / (4 + 36) = 9 / 40 = 22.5%.*
10. **Percentiles:** only among organisations that reached the milestone, method named. *Example: hours to first publication 0.2, 0.5, 1, 3. PostHog's `quantileExact` median picks the 3rd value, 1 hour; `funnel.sql`'s `percentile_cont` interpolates between the 2nd and 3rd, (0.5 + 1) / 2 = 0.75 hours.*
11. **Small samples:** flagged; period totals preferred over single weeks. *Example: in a week of 40 organisations, one organisation moves the rate by 1 / 40 = 2.5 points.*
12. **Money:** currencies kept separate; refunds are separate events; credits, coupons and opening checkout aren't payments. *Example: a $50 purchase and a £40 purchase are two purchases in two currencies, never "90". A $50 purchase later refunded is one purchase plus one refund.*
13. **Eligibility uses current flags:** a later ban or deletion removes an organisation from old cohorts. *Example: Fernhill Software is created in September and banned in November. Once the ban is recorded, it drops out of September's cohort, so September's rate can change after the fact.*
14. **Breakdowns:** only where the source supports them. *Example: until something records where sign-ups come from, every organisation's channel is "unknown"; it isn't spread across channels.*

## Eligible organisation

The cohort behind every group A rate: standard organisations, not banned, not deleted, by current flags. A proposed revision (Exclusion Rules v0) waits for agreement and is listed below.

| Field | Content |
| --- | --- |
| Name, version, status | `eligible_organisation`, v0, provisional |
| Question | Which organisations count as customers in the onboarding and payment cohorts? |
| Grain | One row per organisation |
| Definition | Standard type, not banned, not deleted, by current flags; created before the cutoff. Not a rate itself: it's the denominator of every group A rate. |
| Time field | `organizations_v1.created_at` |
| Excluded today | Community (created by the GitHub Action or the OSS bot, no members); Friendly (a relationship tier, marked by hand); banned (a recorded decision); deleted (by the owner in Settings, or by an admin merge) |
| Unknown and limits | Current flags only, so old cohorts can change. Internal organisations, the demo seed and test fixtures aren't excluded, because nothing in the data marks them. A merged organisation looks the same as a deleted one. |
| Coverage | Organisations still in the database; deleted ones stay as rows |
| Reference | `provisional_eligible` column in `organizations_v1`; `scripts/analytics/posthog/eligible_organisation.sql` |

**Awkward cases**

- **Ban after sign-up.** An organisation banned after it signs up leaves its sign-up week once the ban is recorded, so that week's numbers change after the fact. *Example (invented organisation): Fernhill Software signs up on 5 Oct and is banned on 20 Oct. Until 20 Oct it counts in the week of 5 Oct; after that, that week has one organisation fewer.*
- **Second organisation, same person.** Each organisation counts separately, even when one person owns both. *Example (invented organisation): Lena owns Kestrel Labs and creates a second organisation to try something out. Both count.*
- **Invited member.** Someone joining an existing organisation adds no organisation; the cohort only grows when an organisation is created. *Example: Tom joins Kestrel Labs by invitation. The count doesn't change.*

**Proposed changes** (Exclusion Rules v0; waiting for agreement):

| Case | Today | Proposed |
| --- | --- | --- |
| Deleted | Excluded | Kept in its cohort; deletion counted as a separate event (needs a deletion date in the view) |
| Friendly | Excluded | Kept for activation, flagged; excluded from payment |
| Merged into another organisation | Excluded as deleted | Excluded as merged (needs a merge marker) |
| Demo seed, internal, test fixtures | Included | Excluded (internal list kept privately) |
| Never had a member | Included | Excluded |
| Several organisations, one owner | Each counted | Each counted (main rate). Also show the rate with only each creator's first organisation, from #938's release on, to see how much second organisations affect it (needs the creation provenance view PR) |
| Community, banned | Excluded | Unchanged, counts reported separately |
| High risk score | Included | Unchanged until banned |

**Abuse and uncertain history**

- Exclude an organisation only for what it is (not a real customer), with evidence. Never for what it did, such as low use, and never for a risk score.
- Banned organisations are already left out by the eligibility flags.
- Sign-up weeks affected by known abuse are labelled "uncertain", because some abusive organisations may not have been banned. The affected weeks are listed privately.

*Example: Kestrel Labs signs up through an ad and never connects a repository. It stays in: low intent isn't a reason to exclude.*

*Example: Fernhill Software's founder creates two extra organisations just to test the product. They're excluded only with evidence that they're tests, and only once this rule is agreed.*

## Eligible sign-ups per week

The number of new customer organisations each week; used as a guardrail, and as the size behind every weekly rate.

| Field | Content |
| --- | --- |
| Name, version, status | `eligible_signups_weekly`, v0, provisional |
| Question | How many new customer organisations sign up each week? |
| Grain | One row per sign-up week (Monday) |
| Definition | Count of eligible organisations created in the week, Monday 00:00 to the next Monday 00:00 UTC. A count, not a rate. |
| Time field | `organizations_v1.created_at`, grouped by Monday week |
| Exclusions | As in "Eligible organisation" |
| Unknown and limits | Current flags, so a past week's count can fall later as bans or deletions are recorded. Counts organisations, not people: account registrations are a separate number. |
| Coverage | All history |
| Used as | Guardrail for onboarding changes (a change that raises conversion but cuts sign-ups isn't a win); the denominator size behind weekly rates |
| Reference | `scripts/analytics/posthog/eligible_signups_weekly.sql`; `provisional_organizations` column in `funnel.sql` |

**Awkward cases**

- **A week with no sign-ups.** It must show 0, not disappear. A plain grouped query skips empty weeks, so the next week would look adjacent; a calendar of all weeks fixes that. *Example: if no eligible organisation is created in a week, the chart shows 0 for that week.*
- **A burst from one campaign.** Sign-ups from a campaign stay in, however low their intent; the week is annotated, not cleaned. *Example (invented): a launch post brings 50 sign-ups in one day. The week keeps all 50, with a note.*

## Repository connected, and within 7 days

The first setup step: whether, and how fast, a new organisation brings a repository into Octopus.

| Field | Content |
| --- | --- |
| Name, version, status | `repo_connected_7d`, v0, provisional |
| Question | What share of new customer organisations connect a repository in their first 7 days? |
| Grain | One row per organisation; reported per sign-up week or pooled over a period |
| Denominator | Eligible organisations created at least 7 days before the cutoff |
| Numerator | Of those, organisations whose earliest repository was connected before creation + 7 days |
| Also reported | Repository connected at any time before the cutoff (a count, no window) |
| Time fields | `organizations_v1.created_at`; `repositories_v1.connected_at` (earliest at or after creation) |
| Exclusions | As in "Eligible organisation" |
| Unknown and limits | `connected_at` is when the repository was imported into Octopus, not when the provider (GitHub, GitLab) was connected. A repository removed from the database takes its connection time with it. Repositories can be imported in bulk when a provider is connected, and automatic discovery can add more later. So this means the organisation has a repository in Octopus, not that a person chose that repository. No field tells these apart. |
| Coverage | All retained history |
| Reference | `scripts/analytics/posthog/repo_connected_7d.sql`; `repositories` step in `funnel.sql` |

**Awkward cases**

- **Connected on day 8.** Counts as not connected within 7 days, but as connected overall. *Example (invented organisation): Kestrel Labs is created 1 Oct 10:00 and connects its first repository on 8 Oct 11:00. Within 7 days: no. Ever: yes.*
- **Several repositories.** Only the earliest counts. *Example: Kestrel Labs connects one repository on day 2 and three more on day 10. It counts as connected on day 2.*
- **Repository switched off later.** Still counts; being inactive now doesn't undo the connection. *Example: Kestrel Labs connects a repository on day 2 and deactivates it on day 5. Still connected within 7 days.*
- **Repository older than the organisation.** Ignored, because only connections at or after creation count. This happens when a merge moves repositories into a newer organisation. *Example (invented organisation): Fernhill Software, created 1 Oct, receives through a merge a repository connected on 20 Sep. That repository doesn't count for Fernhill Software.*

## Time to first repository

How fast organisations that do connect a repository get there. Always shown beside the share from "Repository connected, and within 7 days", because it says nothing about organisations that never connect.

| Field | Content |
| --- | --- |
| Name, version, status | `time_to_first_repo`, v0, provisional |
| Question | Among new customer organisations that connect a repository, how quickly do they do it? |
| Grain | One row per organisation that connected within the window |
| Population | Eligible organisations created at least 7 days before the cutoff that connected a repository before creation + 7 days |
| Measure | Median and p90 hours from creation to the earliest repository, with PostHog's `quantileExact` |
| Time fields | `organizations_v1.created_at`; `repositories_v1.connected_at` (earliest at or after creation) |
| Exclusions | As in "Eligible organisation" |
| Unknown and limits | Hours are computed from minutes divided by 60, because counting hour boundaries turns 00:59 to 01:01 into 1 hour. With 10 or fewer organisations, the p90 is simply the slowest one. |
| Coverage | All retained history |
| Reference | `scripts/analytics/posthog/time_to_first_repo.sql` |

**Awkward cases**

- **Organisations that never connect.** Left out of the median; they count only in the share. *Example: a cohort of 10 organisations, 3 of which connect after 0.1, 2 and 30 hours. The median is the middle of those 3 values, 2 hours, not something across all 10.*
- **Connected after the window.** Left out too, so every cohort is measured over the same 7 days. *Example (invented organisation): Kestrel Labs connects on day 9. It's not in the median, though it counts as connected overall.*
- **Recent sign-ups.** Excluded by the 7-day maturity rule. Without it, an organisation created 2 days before the cutoff could only appear if it connected within 2 days, which would make recent weeks look faster. *Example: with a cutoff of 26 Oct, an organisation created 24 Oct isn't measured yet.*
- **Connected within seconds.** Shows as about 0 hours, which is normal, not an error: connecting a provider can import its repositories at once. *Example: Kestrel Labs installs the GitHub App at 10:00:00, and its repository arrives at 10:00:20: 0 hours.*

## Publication observed, and within 14 days

The closest thing to activation we can measure today: an organisation's first review recorded as published. It's a proxy, never reported as the activation rate.

| Field | Content |
| --- | --- |
| Name, version, status | `publication_observed_14d`, v0, provisional |
| Question | What share of new customer organisations get a first review published within 14 days? |
| Grain | One row per organisation |
| Denominator | Eligible organisations created from 21 Sep 2026 and at least 14 days before the cutoff |
| Numerator | Of those, organisations whose earliest recorded publication is before creation + 14 days |
| Time fields | `organizations_v1.created_at`; `review_milestones_v1.first_publication_recorded_at` (earliest across the organisation's PRs, at or after creation) |
| Exclusions | As in "Eligible organisation" |
| Why it's a proxy | The marker is set only after the review is posted successfully. It also covers pull requests with nothing to review (Octopus posts a short coverage report, with no review by the model); skipped reviews don't set it. A posted review can occasionally lack it, if a later step in the same run fails. Publishing doesn't prove anyone read the review. |
| Unknown and limits | The marker exists only from 21 Sep 2026, so earlier cohorts can't be measured. A deleted PR takes its marker with it. |
| Coverage | Cohorts from 21 Sep 2026 |
| Window | 14 days (decided 23 Oct). The provisional dashboard uses 7 days, so its number differs; there's no reference query for 7 days. |
| Reference | `scripts/analytics/posthog/publication_observed_14d.sql`. `funnel.sql` (7 days) and the provisional dashboard also include organisations created before 21 Sep, and the dashboard's summary tile uses `now()`, so their totals differ from this definition. |

**Awkward cases**

- **Empty review.** Counts as a publication observed, though it wouldn't count as activation. *Example (invented organisation): Kestrel Labs opens a PR with no changes to review. Octopus posts a coverage report saying there was nothing to review: publication observed yes, activation no.*
- **Posting failed.** Doesn't count until a later try posts successfully, because the marker is set only after posting. *Example: posting Kestrel Labs's first review to GitHub fails at 10:01, and a retry posts it at 10:20. Publication observed at 10:20.*
- **Created before 21 Sep.** Left out of the rate, because its early reviews weren't recorded. *Example (invented organisation): Fernhill Software is created 15 Sep and gets its first review on 18 Sep. That review left no marker, so whether it published is unknown, not "no".*
- **Published in week 3.** Not within 14 days, but published overall. *Example: Kestrel Labs, created 1 Oct, gets its first review on 17 Oct: day 16.*

## Time to publication observed

How fast organisations that publish within 14 days get their first review published. Always shown beside the 14-day share, because it says nothing about organisations that don't publish.

| Field | Content |
| --- | --- |
| Name, version, status | `time_to_publication_observed`, v0, provisional |
| Question | Among new customer organisations that get a first review published within 14 days, how quickly does it happen? |
| Grain | One row per organisation that published within the window |
| Population | Eligible organisations created from 21 Sep 2026 and at least 14 days before the cutoff, with a first recorded publication before creation + 14 days |
| Measure | Median and p90 hours from creation to the first recorded publication, with PostHog's `quantileExact` |
| Time fields | `organizations_v1.created_at`; `review_milestones_v1.first_publication_recorded_at` (earliest at or after creation) |
| Exclusions | As in "Eligible organisation" |
| Unknown and limits | The same proxy limits as "Publication observed". `funnel.sql` computes this without a fixed window and with interpolation, so its numbers differ. |
| Coverage | Cohorts from 21 Sep 2026 |
| Reference | `scripts/analytics/posthog/time_to_publication_observed.sql` |

**Awkward cases**

- **Never publishes, or publishes after day 14.** Left out of the median; it counts only in the share. *Example (invented organisation): Kestrel Labs gets its first review on day 17. It's not in the median.*
- **Recent sign-ups.** Excluded by the 14-day maturity rule, so recent weeks don't look faster than they are. *Example: with a cutoff of 26 Oct, an organisation created 20 Oct isn't measured yet.*
- **Few publishers.** With 10 or fewer, the p90 is simply the slowest one, and the result is directional only. *Example: 8 organisations publish within 14 days; the p90 is the slowest of the 8.*

## Paid observed, payment order, refunds

Which organisations pay, and whether payment comes before or after their first published review. Three related measures in one entry, because they share the same source and limits.

| Field | Content |
| --- | --- |
| Name, version, status | `paid_observed`, `payment_order`, `refunds_observed`; v0, provisional |
| Question | Which new customer organisations pay, and does payment come before or after their first published review? |
| Grain | One row per organisation |
| Paid observed | At least one purchase at or after creation and before the cutoff. A count per cohort; a time-windowed rate (paid within 30 days of activation) is a later target. |
| Payment order | Among organisations with both a purchase and a publication observed: earliest purchase before, or at or after, the earliest publication. Paid organisations without a publication stay outside both counts. Only for organisations created from 21 Sep 2026. For older organisations the order is unknown, because earlier reviews weren't recorded. |
| Refunds | Separate events, counted separately. A refunded organisation still counts as paid (open question). |
| Time fields | `cash_events_v1.occurred_at`; `review_milestones_v1.first_publication_recorded_at` |
| Exclusions | As in "Eligible organisation". Payment totals must also exclude internal organisations, which the data doesn't mark yet. |
| Unknown and limits | A lower bound: only live payments delivered to Unified Ads, from 19 Sep 2026. Credits, coupons and admin grants aren't payments. USD and GBP are kept apart. An event with conflicting facts is dropped. |
| Coverage | Payments recorded from 19 Sep 2026; payment rates for cohorts from 21 Sep 2026 |
| Reference | `scripts/analytics/posthog/paid_observed_weekly.sql`, `scripts/analytics/posthog/payment_order.sql`, `scripts/analytics/posthog/refunds_observed.sql`; `payments` step in `funnel.sql`. `funnel.sql` and the provisional dashboard also include older organisations, so their totals and payment order differ from this entry's rates and order. |

**Awkward cases**

- **Pays before the first review.** Counts as paid, and as "before" in payment order. *Example (invented organisation): Kestrel Labs buys credits on day 1 and gets its first review on day 3.*
- **Created before 21 Sep.** Payment order is unknown, because earlier reviews weren't recorded. *Example (invented organisation): Fernhill Software, created in August, gets its first review on 1 Sep (not recorded), pays on 1 Oct and gets another review on 5 Oct. The data suggests it paid before its first review, but it paid after, so its order is reported as unknown.*
- **Refunded.** Still counts as paid; the refund is reported separately. *Example: Kestrel Labs pays $50 on 2 Oct and is refunded on 5 Oct: paid yes, one refund.*
- **Paid before 19 Sep.** Not in the data, so the data shows "not paid" when the truth is unknown. Rates on payment therefore use cohorts from 21 Sep on, the first Monday after payment data starts. *Example (invented organisation): Fernhill Software, created in August, paid in August. The data shows no payment for it.*
- **Only free credits.** Not paid. *Example: Kestrel Labs uses its welcome credits and never buys any: not paid.*
- **Two currencies.** Counted once as paid; amounts never added up. *Example: Kestrel Labs pays $50 and later £40: one paid organisation, two purchases in two currencies.*

## First repository provider

A breakdown, not a rate: which code host an organisation connects first. Used to split other metrics.

| Field | Content |
| --- | --- |
| Name, version, status | `first_repo_provider`, v0, provisional |
| Question | Which code host do new customer organisations connect first? |
| Grain | One row per organisation with at least one repository; reported per sign-up month and provider |
| Definition | The provider of the organisation's earliest repository connected at or after creation: GitHub, GitLab, Bitbucket, Forgejo or other |
| Time fields | `repositories_v1.connected_at`, `repositories_v1.provider` |
| Exclusions | As in "Eligible organisation" |
| Unknown and limits | Two first repositories at the same moment with different providers would be resolved arbitrarily; rare. |
| Coverage | All retained history |
| Reference | `scripts/analytics/posthog/first_repo_provider.sql` |

**Awkward cases**

- **Several providers.** Only the first counts. *Example (invented organisation): Kestrel Labs connects a GitLab repository on day 1 and a GitHub one on day 3. First provider: GitLab.*
- **No repository.** Not in this breakdown at all, rather than "unknown provider". *Example (invented organisation): Fernhill Software never connects a repository, so it doesn't appear.*
- **Provider isn't sign-up method.** Where the repository lives says nothing about how the person signed up; that's a separate entry (waiting on #948). *Example: Lena signs up with Google and connects a GitHub repository: provider GitHub, sign-up method Google.*

## Activation

The first time Octopus successfully publishes a real review on one of an organisation's pull requests. It can't be measured yet. Until then, "Publication observed" is the closest proxy and is never reported as activation.

| Field | Content |
| --- | --- |
| Name, version, status | `activation`, v1 proposed, waiting |
| Question | What share of new customer organisations get a first real review published? |
| Grain | One row per organisation |
| Definition | The organisation's first review attempt with kind `substantive` and outcome `published`, on normal PR paths (GitHub, GitLab, Bitbucket, Forgejo). Substantive means coverage complete and assessment completed; zero findings are allowed. |
| Denominator | Eligible organisations created from #940's release and at least 7 (or 30) days before the cutoff |
| Numerator | Of those, organisations activated before creation + 7 days (or 30) |
| Time fields | `organizations_v1.created_at`; the attempt's published time, through the planned review outcome view |
| Exclusions | As in "Eligible organisation" |
| Reported beside it | The shares of partial, uncertain and unresolved attempts. Unresolved means no outcome 24 hours after the first try. |
| Unknown and limits | A pull request with no record is "not recorded", never "not activated" or "unresolved". Recording is best effort, so a failed write can leave no record. GitHub Action, local CLI and community reviews aren't normal PR paths, so they don't activate an organisation. Publishing doesn't prove anyone read the review. A merge leaves activation with the old organisation. |
| Coverage | From the day #940 is live (merged 16 Oct; release date to confirm). Older cohorts are "not recorded". |
| Reference | None yet; waits for the review outcome view PR |

**Awkward cases**

- **No findings.** Counts, because the review was complete. *Example: Kestrel Labs gets a full review that finds no problems: activated.*
- **Empty, skipped, failed or cancelled.** Doesn't count. *Example: Kestrel Labs opens a PR with no changes to review: not activated.*
- **Partial review.** Doesn't count; reported separately. *Example: Octopus reviews only part of a large PR: not activated, and counted in the partial share.*
- **Retry.** The date is when a review is first published. *Example: Kestrel Labs's first try fails on 2 Oct and the retry publishes on 3 Oct: activated on 3 Oct.*
- **Re-review.** Later reviews are activity, not a new activation. *Example: Kestrel Labs is reviewed on 2 Oct and again on 5 Oct: the activation date stays 2 Oct.*
- **Admin retry.** Can activate an organisation, because the review really was published. *Example: an admin retries Kestrel Labs's failed review, and it publishes on 4 Oct: activated on 4 Oct.*
- **Invited member.** Adds no organisation. *Example: Tom joins Kestrel Labs by invitation: nothing changes.*
- **Pays before the first review.** Activation doesn't depend on payment. *Example: Kestrel Labs pays on 1 Oct and gets its first real review on 3 Oct: activated on 3 Oct.*
- **Created before #940's release.** Not recorded, not "not activated". *Example (invented organisation): Fernhill Software was created before recording began, so its first real review may have left no record.*

## Planned entries

Listed so the dictionary shows what's coming and what each one waits for. Each gets a full entry once its data is queryable. Activation already has one, so it can be agreed before its data arrives. The steps between sign-up and payment don't have to happen in a fixed order.

| Entry | Status | Waits for |
| --- | --- | --- |
| Provider connected (GitHub, GitLab, Bitbucket or Forgejo) | Waiting | A tracking event (#925). Not recorded today. Repository connected is close, because connecting a provider usually imports repositories straight away, but it's not the same. |
| Repository enabled for automatic reviews | Waiting | A tracking event (#925). Only the current setting is visible today, with no date. New repositories are usually switched on when imported, so today this is close to repository connected. |
| Review requested (first pull request received) | Waiting | Agreement to use a stand-in, or a tracking event (#925). Stand-in available now: when Octopus first stored a pull request for the organisation (`first_pr_recorded_at`). |
| First successful index | Waiting | #939's script on production, which adds the first index date to the repositories view. Recorded from 15 Oct; empty means "not recorded", never "never indexed". |
| Sign-up method | Waiting | #948's review and merge, its script on production, then the view added in PostHog |
| Creation provenance, including a creator's first organisation | Waiting | The creation provenance view PR. Recorded from #938's release (merged 16 Oct, live by 20 Oct; exact date to confirm). |
| Activation v1 (first substantive published review), with the shares of partial, uncertain and unresolved | Waiting | Confirmation that #940's table exists on production, then the review outcome view PR. Definition in the entry above. |
| Cancellations | Waiting | The cancellation PR, its release and migration, then the review outcome view |
| External review activity by source | Waiting | #952's release and migration, then its view PR |
| Review viewed | Target | A tracking event (#925), only where a view can really be measured, such as a page in the Octopus app. Reviews read on GitHub, GitLab or Bitbucket can't be seen, so they count as "unknown", never as "not viewed". *Example: a Kestrel Labs developer reads its review on GitHub. Octopus can't see this, so the view is unknown.* |
| Activated to paid within 30 days | Target | Activation v1, plus 30 days of observation after it. **Definition:** of the organisations activated, the share whose first payment comes within 30 days after activation. Only organisations with no earlier payment and a full 30 days observed; organisations that paid first are a separate group. *Example: Kestrel Labs is activated on 3 Oct and pays on 20 Oct, 17 days later: paid within 30 days. Example: an organisation activated on 25 Oct has had only 15 days by 9 Nov, so it's left out until its 30 days are over.* |
| Paid retention | Target | Activation v1 and enough paying organisations to measure. **Definition:** for each complete 7-day period after the first payment, the paying organisations with a substantive published review in that period, divided by the paying organisations old enough to reach it. Week 1 is the first 7 days after the first payment. Re-reviews count as activity, not as new activations. *Example: Kestrel Labs first pays on 1 Oct, so its week 2 is 8 to 14 Oct; a real review on 9 Oct makes it active in week 2. Example: if 10 paying organisations have reached week 2 and 6 are active, week 2 retention is 6 / 10 = 60%.* |
| Acquisition channel | Target | A product decision: map campaign links to channels, or record where visitors come from. Until then, "unknown". |

## Tracking plan (draft)

The events Octopus will send to PostHog once #925 is built. Nothing is sent yet. The rules below apply to every event; the event list is the one in `docs/product-analytics.md`, unchanged.

| Rule | Applies to every event |
| --- | --- |
| Event ID | Unique per event. A resend reuses the same ID, so duplicates are dropped. |
| Time | When it happened, in UTC, not when it was sent |
| Organisation | The organisation's ID, on every event |
| User | A separate ID, optional, never an email. Background work has none. |
| Who sends it | One sender per outcome. The browser records attempts, and the server records results. |
| Allowed information | Only what's listed for that event. No names, emails or free text, and no automatic recording of clicks or screens. |
| Consent | Browser events follow the existing consent rules |
| Exclusions | The same as "Eligible organisation", applied when querying |
| Retention | To be confirmed: how long PostHog keeps these events |

Every event also carries `product` (octopus), `environment`, `schema_version`, `source` (web, cli or server) and `release` when known.

| Event | Sent by, and when | Additional allowed properties |
| --- | --- | --- |
| `organization_created` | Server, after the creation is committed | Creation method, cohort-classification version |
| `provider_connection_started` | Browser or CLI, when a user explicitly starts connecting | Provider, attempt ID |
| `provider_connection_completed` / `provider_connection_failed` | Server, with the final result | Provider, attempt ID, failure category |
| `repository_enabled` | Server, after the enablement is saved | Repository ID, provider |
| `repository_index_completed` / `repository_index_failed` | Server, with the final result | Repository ID, attempt ID, failure category |
| `review_requested` | Server, when a request is accepted | PR, repository and attempt IDs, provider |
| `review_published` / `review_failed` | Server, with the confirmed final outcome | PR, repository and attempt IDs, coverage and assessment values, substantive flag |
| `review_viewed` | Only where a view can really be measured | PR or repository ID, surface; never claims views on GitHub, GitLab or Bitbucket |
| `checkout_started` | Browser, when a user explicitly starts checkout | Attempt ID; never counted as a payment |
| `payment_succeeded` / `payment_refunded` | The existing billing record | Event ID, amount in minor units, currency |

## Reference queries

One query per measurable entry or measure, in PostHog's HogQL, kept as separate files in `scripts/analytics/posthog/`. Each file starts with its grain and check. PostHog prefixes the imported views, so `organizations_v1` appears as `octopus_analyticspostgres_organizations_v1`. Each query uses an automatic cutoff, the most recent Monday at 00:00 UTC; to reproduce a documented result, replace it with that date. The first eight were checked on 9 Nov 2026 against earlier results; payment order and refunds were added on 11 Nov 2026 and checked by their own sums and against "Paid observed per sign-up week". `scripts/analytics/funnel.sql` remains the PostgreSQL reconciliation reference.

| Entry | File |
| --- | --- |
| Eligible organisation | `scripts/analytics/posthog/eligible_organisation.sql` |
| Eligible sign-ups per week | `scripts/analytics/posthog/eligible_signups_weekly.sql` |
| Repository connected within 7 days | `scripts/analytics/posthog/repo_connected_7d.sql` |
| Time to first repository | `scripts/analytics/posthog/time_to_first_repo.sql` |
| Publication observed within 14 days | `scripts/analytics/posthog/publication_observed_14d.sql` |
| Time to publication observed | `scripts/analytics/posthog/time_to_publication_observed.sql` |
| Paid observed per sign-up week | `scripts/analytics/posthog/paid_observed_weekly.sql` |
| Payment order | `scripts/analytics/posthog/payment_order.sql` |
| Refunds observed | `scripts/analytics/posthog/refunds_observed.sql` |
| First repository provider | `scripts/analytics/posthog/first_repo_provider.sql` |

## Open for agreement

Each needs the product owner's agreement before the entries it affects move from v0 to v1. Once agreed, the change is noted in the entry.

1. The Activation entry.
2. The Exclusion Rules v0 proposals in "Eligible organisation".
3. Whether a refunded organisation counts as paid.
4. Payment rates only from 21 Sep cohorts.
5. Whether this dictionary replaces the eight-measure table in `docs/product-analytics.md` or sits beside it.
6. How long PostHog keeps tracking-plan events.
