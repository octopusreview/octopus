# Prompt caching

Octopus sends the full request after every model/provider switch. A cache is a provider-side optimization, not the conversation store: switching from Claude to OpenAI starts a separate cache; switching back can reuse an entry only while the provider still retains the matching prefix. Switching never locks the model or drops history.

The review prompt places shared instructions before `<!--CACHE_BREAKPOINT-->`; prior-review context, diff-selected rules and conflict context follow it. Anthropic marks only that stable prefix. The [Anthropic adapter](../apps/web/lib/providers/anthropic.ts) uses `PROMPT_CACHE_TTL=5m` for five-minute writes; `1h`, unset or invalid values use one hour. This existing policy is unchanged; configure it in the deployment environment (see [.env.example](../.env.example)).

OpenAI caching is automatic. For `cacheSystem` requests with a nonempty stable system prefix, Octopus sends an opaque `prompt_cache_key` on both Chat Completions and Responses API requests, derived from organization, exact model, prefix and schema, authenticated with the selected API credential. The same organization/model/credential/prefix/schema yields the same routing hint after switching back. Different customers, models, rotated/BYOK credentials, prefixes or schemas yield different hints. The key contains no plaintext customer identifier, prompt or credential. It is not an authorization boundary or a guarantee of a provider hit. Calls without an organization, credential or nonempty cacheable prefix omit it. Retention remains the provider/account default; no new paid explicit-cache mode is enabled.

Web and shared OpenAI chats preserve the existing stable-instruction/dynamic-context boundary when building that key. Marker text supplied inside either part is stripped before inserting the trusted boundary; all other content and conversation messages are retained. Other providers keep their existing request format.

## Accounting

Usage retains provider-native input semantics for compatibility with existing records: Anthropic `input_tokens` excludes cache reads/writes; OpenAI total input includes them. `calcCost` accepts the recorded provider and interprets that distinction at calculation time. Both the usage logger and reporting callers pass it; reporting groups by provider as well as model. Existing rows, charged-cost snapshots and credit balances are not rewritten. Historical breakdowns are current-rate estimates, not invoice or historical-debit reconciliation.

Anthropic streaming chat keeps its existing five-minute retention for cacheable prefixes. Its usage result carries that request TTL through web, CLI and queued-chat callers to settlement, so writes cost 1.25x even when `PROMPT_CACHE_TTL=1h`. Review requests retain their configured TTL: five-minute writes cost 1.25x base input and one-hour writes cost 2x. TTL is not added to stored usage: historical reports without it still estimate writes using the current deployment TTL. New charged-cost snapshots continue to record only the successful deduction.

OpenAI cache-write counters are retained when returned; their 1.25x replacement rate is independent of Anthropic's configured TTL. Absence of a write field means zero recorded writes. Fable 5.1, Fable 5.2 and Mythos 5.1 use their published 0.025x read rate, Opus 5.5 uses 0.05x. Direct OpenAI text-model cached-input exceptions, including dated variants, are:

| Multiplier | Models |
| --- | --- |
| 0.5x | [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o), [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [GPT-4.5 preview](https://developers.openai.com/api/docs/models/gpt-4.5-preview), [o1](https://developers.openai.com/api/docs/models/o1), [o1-mini](https://developers.openai.com/api/docs/models/o1-mini), [o1-preview](https://developers.openai.com/api/docs/models/o1-preview), [o3-mini](https://developers.openai.com/api/docs/models/o3-mini) |
| 0.25x | [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1) (including mini/nano), [o3](https://developers.openai.com/api/docs/models/o3), [o4-mini](https://developers.openai.com/api/docs/models/o4-mini), [o3-deep-research](https://developers.openai.com/api/docs/models/o3-deep-research), [o4-mini-deep-research](https://developers.openai.com/api/docs/models/o4-mini-deep-research) |

These exceptions match only the listed model names and optional dated suffixes, not unknown sibling families. Other names retain the existing 0.1x estimate. Settlement and reports share this mapping. Other providers' adapters and caching modes are unchanged.

Sources checked 2026-09-26: [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching). Exact-prefix eligibility, retention, rates and minimum token counts vary by model and endpoint. Cache writes and outputs still cost money; cached-input discounts do not describe whole-review savings.

## Validation and operation

The isolated `prompt-cache.test.ts` executes the real streaming helper, router, adapters, prompt substitution and usage logger against synthetic SDK/DB responses, with network access rejected. It checks stable request prefixes, injected markers, full history, switching back, tenant/model/key separation, both OpenAI endpoints, request-TTL settlement, published cached-input rates and charged snapshots while retaining raw counters. This is request-contract evidence, not a live cache-hit or review-quality claim.

Evaluate actual read/write token counts and net cost on comparable accepted reviews before extending retention. Do not prewarm with customer code, replay production reviews, reprice historical credits or switch customers to improve cache statistics. No database migration is required.
