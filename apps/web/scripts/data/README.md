# Review eval harness data

`bun run --cwd apps/web eval:review` reads this directory.

- **review-recall-fixtures.json** — known-bug fixtures for recall. Each entry:
  `{ "name": "...", "expected": ["<finding-signature>", ...], "reported": ["<finding-signature>", ...] }`.
  `expected` = signatures a good reviewer SHOULD surface for that PR; `reported`
  = signatures it actually surfaced on an offline replay. Recall = matched /
  expected. Empty `[]` ⇒ recall reported as `n/a` (never faked). Populate from
  labelled real PRs; `signature` is `ReviewIssue.signature`.
- **review-eval-baseline.json** — recorded baseline; regenerate with
  `eval:review --update-baseline`. Later runs diff against it and fail CI on a
  precision/recall drop or fp-rate rise beyond `--tolerance` (default 0.05).
- **review-eval-report.json** — latest run output (gitignored churn is fine to commit for history).
