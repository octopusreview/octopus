---
title: OpenAI GPT-6 Astra is now available in Octopus
slug: gpt-6-astra-now-available
excerpt: OpenAI released GPT-6 Astra on September 3, and it can now review your pull requests. What it is, what it costs, and when to pick it over your default.
category: Product
tags: [GPT-6 Astra, OpenAI, Models, Code Review, Pricing]
authorName: Octopus Team
---

OpenAI released GPT-6 Astra on September 3, and it is already in Octopus. You can pick it as the review model for an organization or a single repository, on our cloud or with your own OpenAI key.

## What it is

GPT-6 Astra is OpenAI's new flagship, the successor to GPT-5.6 Sol. Three things about it matter for code review.

It is big on context: a 1,050,000-token window and up to 128,000 output tokens in one answer, so a large diff plus the surrounding code fits without trimming. It reasons before it answers, with an effort setting that goes from low to max. And OpenAI trained it hard on finding bugs and security flaws: it is the first OpenAI model the company classifies as "Critical" for cybersecurity, and access to the most advanced exploit capabilities is limited to a separate program. For review work that is the interesting part. A model that is good at finding vulnerabilities in other people's code is also good at finding them in your pull request.

On coding benchmarks it lands at the top of the pack rather than far ahead of it. OpenAI's own numbers, run at maximum effort, put it just under 58 percent on Terminal-Bench 4.0, ahead of Claude Fable 5.1 at 55.8 and Claude Opus 5 at 52.3, and at 74.1 percent on DeepSWE v1.1 against 67.4 for Fable 5.1. On Artificial Analysis's independent Coding Agent index the three are within a point of each other, with Fable 5 slightly ahead. So treat Astra as a reason to try, not as a verdict. Your own code is the benchmark that counts.

OpenAI's announcement is at [openai.com/index/gpt-6-astra](https://openai.com/index/gpt-6-astra/), the model card with limits and prices at [developers.openai.com](https://developers.openai.com/api/docs/models/gpt-6-astra), and Vellum has a readable walk through the numbers at [vellum.ai](https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained).

## Your default does not change

Nothing changes unless you ask it to. Reviews keep running on the same model at the same cost. GPT-6 Astra is an option you switch on per organization or per repository in Settings, and you can switch back any time. Your review history, and everything Octopus has learned about your codebase, carry over.

## What GPT-6 Astra costs

OpenAI's list price is $10 per million input tokens and $50 per million output tokens, with cached input at $1. That is 2.5 times GPT-5.6 Sol and exactly the price of Claude Fable 5.1. Octopus Cloud bills usage at twice the provider's list price, which is our platform rate and the only fee, so on our credits that comes to $20 and $100. For comparison, list prices per million tokens:

| Model | Input | Output |
|---|---|---|
| GPT-6 Astra | $10 | $50 |
| Claude Fable 5.1 | $10 | $50 |
| Claude Opus 5 (Cloud default) | $5 | $25 |
| GPT-5.3 Codex | $1.75 | $14 |

Output tokens are where review bills grow, because findings, explanations and suggested patches are all output. Against Opus 5, Astra costs twice as much on both sides. With your own OpenAI key, Octopus charges nothing for the model call and OpenAI bills you at list.

Two OpenAI details you do not need to worry about on Octopus. Fast mode, which doubles the price for speed, is not used for reviews. And the long-context surcharge, which doubles input pricing on requests above 272,000 input tokens, is never triggered: Octopus caps the diff it sends at 300,000 characters, roughly 75,000 tokens, and tells you when a diff was cut.

The full table is on the [pricing page](/docs/pricing).

## When GPT-6 Astra is worth trying

- Security-sensitive changes: authentication, payments, anything that parses untrusted input. This is where OpenAI's cyber training should show.
- Very large pull requests. The 1M window means less trimming and more of the surrounding code in view.
- Teams already standardized on OpenAI who want reviews billed to an account they control.
- Any repository where you want a second opinion next to your Claude default on the changes that matter most.

Keep your current model on routine work, at least until you have compared the two on your own code. That is what the per-repository setting is for.

## A few things to know

Octopus calls GPT-6 Astra through OpenAI's Chat Completions API with structured output, the same path as our other OpenAI models, and leaves the reasoning effort at OpenAI's default. The small helper calls around a review, such as classifying your replies to comments, run on a separate internal model and are not affected by which review model you pick.

A reasoning model takes longer than one that answers straight away, so expect a longer wait on a big change.

OpenAI is rolling Astra out in phases. Our OpenAI account already lists it, so reviews on Octopus credits work today. If you bring your own key and the model is not in your account yet, the review fails with OpenAI's error until your access arrives; switch back to your default in the meantime.

OpenAI is listed on our [sub-processors page](/docs/sub-processors), and the [security overview](/docs/security-overview) describes what leaves your repository.

## How to switch it on

1. Open Settings in Octopus and go to Models.
2. Choose GPT-6 Astra as the review model for your organization, or open a repository and pick it there.
3. Optionally, paste an OpenAI key under API keys in Settings. Reviews then run on your account instead of our credits.
4. Open a pull request. The next review runs on Astra.

Self-hosting? Set `OPENAI_API_KEY` in your environment and add the model to your catalog; it then shows up in the same Settings dropdowns. The [self-hosting docs](/docs/self-hosting) have the details.

## Questions we expect

**Is Astra the new default?** No. The Octopus Cloud default stays [Claude Opus 5](/blog/claude-opus-5-now-available). GPT-6 Astra is opt-in.

**Which id should I use in the API or CLI?** `gpt-6-astra`. That is OpenAI's official id, and it is what appears in usage reports.

**Is it better than Fable 5.1 for reviews?** Same price, different strengths. Astra leads on OpenAI's terminal and security benchmarks, Fable 5.1 leads on the independent Artificial Analysis index. Run both on a few real pull requests and keep the one that finds what your team misses.

Not sure whether it makes sense for your team? Reply to any Octopus email or ask in the app. It comes straight to us.
