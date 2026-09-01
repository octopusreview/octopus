---
title: Claude Fable 5.1 is now available in Octopus
slug: claude-fable-5-1-now-available
excerpt: Anthropic's most capable generally available model can now review your pull requests. What it is, what it costs, and when to switch it on.
category: Product
tags: [Claude, Models, Code Review, Fable]
authorName: Octopus Team
---

Claude Fable 5.1 is out, and you can pick it as your reviewer in Octopus right now.

## What it is

Fable 5.1 is the successor to Fable 5. It sits in the same tier, which Anthropic places above the Opus family, and it is their most capable model that anyone can use without special approval. Its sibling, Mythos 5.1, is the same underlying model offered to a small set of approved organizations with fewer safeguards. Octopus runs Fable 5.1.

Compared with Opus, the main difference is how long it thinks before it answers. It also keeps a 1M-token context window, so it can hold a large diff and the surrounding code in view while it works. Anthropic's own write-up is at [anthropic.com/claude/fable](https://www.anthropic.com/claude/fable).

## Your default does not change

Nothing changes unless you ask it to. Reviews keep running on the same model at the same cost. Fable 5.1 is an option you switch on, per organization or per repository, in Settings.

If you bring your own Anthropic key, it works there too.

## What it costs

Fable 5.1 is priced the same as Fable 5: $10 per million input tokens and $50 per million output tokens on Anthropic's API, which is twice Opus 5. Octopus applies its usual platform rate on top, so a review on Fable 5.1 costs roughly twice what the same review costs on Opus. The full numbers are on the [pricing page](/docs/pricing).

So we would not switch every repository to it. Use it on the pull requests where the extra cost buys you something.

## When it is worth it

Reach for Fable 5.1 on the changes where a missed problem is expensive:

- Concurrency, and anything with shared state
- Security-sensitive code: auth, permissions, payments, anything that touches secrets
- Large refactors, where the risk is in how the pieces fit together rather than in any single line
- Subtle logic, where a second careful read is worth paying for

For routine changes, your current default model is the better deal.

## A few things to know

Reviews on Fable 5.1 can take longer, sometimes noticeably. The model spends more time thinking before it writes, and that is where the quality comes from. Octopus streams these calls and waits for the model to finish, so you will not hit a timeout, but expect to wait longer on a big change.

The model also has a safety layer that, in rare cases, may decline a request. If that ever happens to a review, Octopus reports it as a failed review with the reason instead of quietly posting nothing. We expect this to be uncommon for ordinary code.

## How to switch it on

1. Open Settings in Octopus.
2. Choose Claude Fable 5.1 as the review model for your organization, or for a single repository.
3. Open a pull request. The next review runs on it.

Switch back any time. Your review history, and everything Octopus has learned about your codebase, carry over.

Not sure whether it makes sense for your team? Reply to any Octopus email or ask in the app. It comes straight to us.
