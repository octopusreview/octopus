---
title: Qwen3.8-Max-0902 is now available in Octopus
slug: qwen3-8-max-0902-now-available
excerpt: Qwen3.8-Max-0902 just topped Arena's WebDev board, and it can now review your pull requests. What it costs, and when to pick it over your default.
category: Product
tags: [Qwen3.8-Max-0902, Qwen, Models, Code Review, Alibaba Cloud, Pricing]
authorName: Octopus Team
coverImageUrl: https://cdn.octopus-review.ai/blog/qwen3-8-max-0902/cover.png
---

Alibaba released Qwen3.8-Max-0902 today, and it is already in Octopus. You can pick it as the review model for an organization or a single repository, on our cloud or with your own Alibaba Cloud Model Studio key.

## What it is

Qwen3.8-Max is Alibaba Cloud's newest Qwen model, and 0902 is the snapshot published on September 2. Two things about it matter for code review. It has a 1M-token context window and can write up to 131,072 tokens in one answer, so a large diff plus the surrounding code fits without trimming. And it reasons before it answers: thinking is on by default, and you can tell the model to skip it.

The reason people are talking about it is Arena. On the Code Arena: WebDev leaderboard, Qwen3.8-Max-0902 debuted in first place with 1,691 points, 3 points ahead of Claude Opus 5 (Max) at 1,688, 17 ahead of Kimi K3 (Max) and 22 ahead of the previous Qwen3.8-Max. Arena scores come from blind, side-by-side votes on real web development tasks, which is closer to review work than most benchmarks. It is still one leaderboard, so treat it as a reason to try the model, not as proof it will suit your codebase.

![Arena Code Arena: WebDev leaderboard on September 2, 2026: Qwen3.8-Max-0902 first with 1,691 points, Claude Opus 5 (Max) second with 1,688, Kimi K3 (Max) third with 1,674](https://cdn.octopus-review.ai/blog/qwen3-8-max-0902/arena-code-webdev-2026-09-02.png)

*Chart: Arena.ai, Code Arena: WebDev, September 2, 2026.*

Alibaba's model page is at [alibabacloud.com/help/en/model-studio/qwen3-8-max](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max), and Arena's announcement is [on X](https://x.com/arena/status/2094974637704913198).

## Your default does not change

Nothing changes unless you ask it to. Reviews keep running on the same model at the same cost. Qwen3.8-Max is an option you switch on per organization or per repository in Settings, and you can switch back any time. Your review history, and everything Octopus has learned about your codebase, carry over.

## What Qwen3.8-Max costs

Alibaba's list price on the international endpoint is $2 per million input tokens and $6 per million output tokens, with cached input at $0.25. Octopus Cloud bills usage at twice the provider's list price, which is our platform rate and the only fee, so on our credits that comes to $4 and $12. For comparison, list prices per million tokens:

| Model | Input | Output |
|---|---|---|
| Qwen3.8-Max | $2 | $6 |
| Claude Sonnet 5 | $2 | $10 |
| Claude Opus 5 (Cloud default) | $5 | $25 |

Output tokens are where review bills grow, because findings, explanations and suggested patches are all output. Against Opus 5, Qwen3.8-Max costs 40 percent as much on input and about a quarter on output. With your own Alibaba key, Octopus charges nothing for the model call and Alibaba bills you at list.

The full table is on the [pricing page](/docs/pricing).

## When Qwen3.8-Max is worth trying

- Busy repositories where review cost adds up faster than risk does: dependency bumps, generated code, routine feature work
- Very large pull requests. The 1M window means less trimming and more of the surrounding code in view
- Teams already on Alibaba Cloud who want reviews billed to an account they control
- Any repository where you want a second, cheaper opinion next to your main model

Keep your current model on the changes where a missed problem is expensive, at least until you have compared the two on your own code. That is what the per-repository setting is for.

## A few things to know

Octopus runs Qwen3.8-Max through Alibaba's OpenAI-compatible endpoint. On our cloud that is the international endpoint in Singapore, so your diff and the retrieved context are processed there, not in mainland China. Alibaba Cloud is listed on our [sub-processors page](/docs/sub-processors), and the [security overview](/docs/security-overview) describes what leaves your repository.

Octopus leaves thinking on for the review itself and raises the output ceiling so the model cannot run out of room while it reasons. The small helper calls around a review, such as classifying your replies to comments, run on a separate internal model and are not affected by which review model you pick.

Reviews on a thinking model take longer than on one that answers straight away, so expect a longer wait on a big change.

If you bring your own key, note that Alibaba Cloud keys are tied to a region. A key from the international (Singapore) console works with Octopus Cloud. A key from the China console does not, unless you self-host and point `DASHSCOPE_BASE_URL` at the China endpoint. The [self-hosting docs](/docs/self-hosting) cover that.

## How to switch it on

1. Open Settings in Octopus and go to Models.
2. Choose Qwen3.8-Max as the review model for your organization, or open a repository and pick it there.
3. Optionally, paste an Alibaba Cloud Model Studio key under API keys in Settings. Reviews then run on your account instead of our credits.
4. Open a pull request. The next review runs on Qwen.

Self-hosting? Set `DASHSCOPE_API_KEY` in your environment and add the model to your catalog; it then shows up in the same Settings dropdowns. The [self-hosting docs](/docs/self-hosting) have the details.

## Questions we expect

**Is Qwen the new default?** No. The Octopus Cloud default stays [Claude Opus 5](/blog/claude-opus-5-now-available). Qwen3.8-Max is opt-in.

**Does my code go to China?** Not on Octopus Cloud. We use Alibaba Cloud's international endpoint in Singapore. Self-hosters choose the endpoint themselves.

**Which id should I use in the API or CLI?** `qwen3.8-max-0902`. That is Alibaba's official id for this snapshot, and it is what appears in usage reports.

Not sure whether it makes sense for your team? Reply to any Octopus email or ask in the app. It comes straight to us.
