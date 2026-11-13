---
title: Claude Fable 5.2 is now available in Octopus
slug: claude-fable-5-2-now-available
excerpt: Anthropic's most capable generally available model has a new version, and it costs 20% less than the last one. What it is, what it costs, and when to switch it on.
category: Product
tags: [Claude, Models, Code Review, Fable]
authorName: Octopus Team
---

Claude Fable 5.2 came out on 9 November, and you can pick it as your reviewer in Octopus now.

## What it is

Fable 5.2 is the successor to Fable 5.1. It sits in the same tier, which Anthropic places above the Opus family, and Anthropic calls it their most capable generally available model for technical fields. Like 5.1 it keeps a 1M-token context window, so it can hold a large diff and the surrounding code in view while it works. Anthropic's own write-up is at [anthropic.com/claude/fable](https://www.anthropic.com/claude/fable).

## It costs less than 5.1

Fable 5.2 is $8 per million input tokens and $40 per million output tokens on Anthropic's API. Fable 5.1 is $10 and $50. Octopus applies its usual platform rate on top of either, so the same review costs about a fifth less on 5.2. The full numbers are on the [pricing page](/docs/pricing).

Cached reads are $0.20 per million tokens. Octopus caches the stable part of a review prompt, so a repository you review often gets that rate on much of its input.

## Your default does not change

Nothing changes unless you ask it to. Reviews keep running on the same model at the same cost, and a repository pinned to Fable 5, Fable 5.1 or anything else stays where it is. Fable 5.2 is an option you switch on, per organization or per repository, in Settings.

If you are already on Fable 5.1, 5.2 is the cheaper of the two, and very large pull requests work the same way on both: Octopus can send the complete changed source when it fits the review admission limits. Otherwise, a review may use a bounded diff or be refused admission.

If you bring your own Anthropic key, it works there too.

## When it is worth it

Reach for Fable 5.2 on the changes where a missed problem is expensive:

- Concurrency, and anything with shared state
- Security-sensitive code: auth, permissions, payments, anything that touches secrets
- Large refactors, where the risk is in how the pieces fit together rather than in any single line
- Subtle logic, where a second careful read is worth paying for

For routine changes, your current default model is the better deal.

## A few things to know

Reviews on Fable 5.2 can take longer, sometimes noticeably. The model spends more time thinking before it writes, and that is where the quality comes from. Octopus streams these calls, but they can still time out, so expect to wait longer on a big change.

The model also has a safety layer that, in rare cases, may decline a request. If that ever happens to a review, Octopus reports it as a failed review with the reason instead of quietly posting nothing. We expect this to be uncommon for ordinary code.

One thing to check if you use your own Anthropic key: Anthropic requires its standard 30-day data retention for Fable 5.2. If your account is set to zero data retention, Anthropic rejects the request and Octopus reports the review as failed. Fable 5.1 and the Opus models are not affected.

## How to switch it on

1. Open Settings in Octopus.
2. Choose Claude Fable 5.2 as the review model for your organization, or for a single repository.
3. Open a pull request. The next review runs on it.

Switch back any time. Your review history, and everything Octopus has learned about your codebase, carry over.

Not sure whether it makes sense for your team? Reply to any Octopus email or ask in the app. It comes straight to us.
