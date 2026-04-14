---
name: False positive reduction from PR #186 analysis
description: Analysis of 8 false positives from PR #186 review, root causes identified, and rules added to SYSTEM_PROMPT.md and review-validation.ts
type: feedback
---

PR #186 (feat: delegate chat answer generation to local agent) produced 10 findings, 8 of which were false positives (80% FP rate). Root causes clustered into 6 categories:

1. **Cross-function context blindness** (FP #1, #6): Reviewer analyzed new functions in isolation without tracing the call chain. The caller already handled the "missing" operation.
2. **Ignoring existing codebase patterns** (FP #2, #3): Reviewer flagged patterns (unencrypted JSON columns, polling loops) that are established conventions used throughout the project.
3. **Over-aggressive DRY enforcement** (FP #4, #7): Flagged intentional code separation as duplication without considering that the paths serve different purposes.
4. **Schema-unaware analysis** (FP #5): Flagged column size concerns without checking that the column is TEXT type (handles 1GB+).
5. **Magic number overreach** (FP #8): Flagged a 5ms cosmetic streaming delay as needing to be configurable.
6. **Generic security heuristics** (FP #2): Applied "encrypt data at rest" without checking if ANY data in the project is encrypted.

**Fix applied:** Added rules 27-32 to SYSTEM_PROMPT.md review_rules and corresponding validation criteria to review-validation.ts two-pass prompt.

**Why:** 80% FP rate destroys developer trust in the tool. These FP categories are systematic, not one-off.

**How to apply:** When future FP reports come in, check if they fall into these 6 categories first. If a new category emerges, add a corresponding rule to both the system prompt AND the two-pass validation prompt.
