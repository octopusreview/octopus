import Link from "@/components/link";
import { docsPageJsonLd, jsonLd, pricingProductJsonLd } from "@/lib/structured-data";
import {
  IconSparkles,
  IconCreditCard,
  IconKey,
  IconShieldCheck,
  IconRefresh,
  IconChartBar,
} from "@tabler/icons-react";

export const metadata = {
  title: "AI code review pricing and cost per review",
  description:
    "Usage-based pricing for AI code review. See median charges per review from real Octopus Cloud usage by model, or bring your own API keys.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/pricing",
  },
};

// Median amount charged per review on Octopus Cloud (platform keys, 2x rate
// included) in the 30 days up to 14 November 2026, by thirds of review size.
const REVIEW_COSTS: Array<[model: string, smaller: string, middle: string, larger: string]> = [
  ["Claude Opus 5.5 (the Cloud default)", "$0.52", "$0.76", "$1.13"],
  ["Claude Fable 5.2", "$1.03", "$1.49", "$2.40"],
  ["Claude Haiku 4.5", "$0.06", "$0.09", "$0.12"],
  ["GPT-5.3 Codex", "$0.14", "$0.16", "$0.20"],
];

export default function PricingPage() {
  return (
    <article className="max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            docsPageJsonLd({
              title: metadata.title,
              description: metadata.description,
              path: "/docs/pricing",
              crumb: "Pricing",
            }),
          ),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(pricingProductJsonLd()) }}
      />
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconCreditCard className="size-4" />
          Pricing
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Pricing
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Free to start. Pay only for what you use, or bring your own API keys
          and pay your providers directly.
        </p>
      </div>

      {/* Plans overview */}
      <Section title="How It Works">
        <P>
          Octopus uses a credit-based system. Every AI operation (reviews,
          analysis, chat, embeddings) consumes credits based on the model and
          token count. New organizations start with free credits to get going.
        </P>
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <PlanCard
            title="Free Tier"
            highlight
            features={[
              "Free credits on sign-up",
              "All review features included",
              "All integrations available",
              "Community support",
            ]}
          />
          <PlanCard
            title="Usage-Based"
            features={[
              "Pay only for AI tokens consumed",
              "Purchase credits via Stripe",
              "Auto-reload when balance is low",
              "Configurable spend limits",
            ]}
          />
        </div>
        <P>
          Live team telemetry requires a paid org (any credit purchase or BYOK).
        </P>
      </Section>

      {/* BYO Keys */}
      <Section title="Can I use my own API keys?">
        <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#888]">
              <IconKey className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                Use your own API keys, pay zero credits
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#888]">
                Configure your own Anthropic, OpenAI, Google, Alibaba Cloud,
                or Cohere API keys in the organization settings. When you bring your own keys,
                Octopus routes requests using those keys to your provider account
                and deducts no credits for them. Operations using other platform
                providers, such as embeddings, still consume credits.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {["Anthropic", "OpenAI", "Google AI", "Alibaba Cloud", "Cohere"].map((p) => (
                  <span
                    key={p}
                    className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs text-[#888]"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Model pricing */}
      <Section title="How much does each model cost?">
        <P>
          Credit consumption varies by model. Octopus Cloud bills usage at 2x
          the provider&apos;s list price; that multiple is the platform rate, and
          there are no other fees. Below are the provider list prices per 1M
          tokens:
        </P>
        <div className="mb-4 overflow-x-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-4 py-2 font-medium text-[#999]">Model</th>
                <th className="px-4 py-2 text-right font-medium text-[#999]">Input</th>
                <th className="px-4 py-2 text-right font-medium text-[#999]">Output</th>
              </tr>
            </thead>
            <tbody className="text-[#888]">
              <ModelRow model="Claude Sonnet 5.5" input="$2" output="$10" />
              <ModelRow model="Claude Opus 5.5" input="$4" output="$20" />
              <ModelRow model="Claude Fable 5.2" input="$8" output="$40" />
              <ModelRow model="Claude Fable 5.1" input="$10" output="$50" />
              <ModelRow model="Claude Fable 5" input="$10" output="$50" />
              <ModelRow model="Claude Opus 5" input="$5" output="$25" />
              <ModelRow model="Claude Opus 4.8" input="$5" output="$25" />
              <ModelRow model="Claude Sonnet 5" input="$2" output="$10" />
              <ModelRow model="Claude Sonnet 4.6" input="$3" output="$15" />
              <ModelRow model="Claude Sonnet 4" input="$3" output="$15" />
              <ModelRow model="Claude Opus 4" input="$15" output="$75" />
              <ModelRow model="Claude Haiku 4.5" input="$1" output="$5" />
              <ModelRow model="Gemini 2.5 Pro" input="$1.25" output="$10" />
              <ModelRow model="Gemini 2.5 Flash" input="$0.15" output="$0.60" />
              <ModelRow model="GPT-6 Astra" input="$10" output="$50" />
              <ModelRow model="GPT-5.3 Codex" input="$1.75" output="$14" />
              <ModelRow model="Grok 4.6" input="$2" output="$6" />
              <ModelRow model="Qwen3.8-Max" input="$2" output="$6" />
              <ModelRow model="Kimi K3 (via OpenRouter)" input="$3" output="$15" />
              <ModelRow model="Embeddings (text-embedding-3-large)" input="$0.13" output="—" />
              <ModelRow model="Embeddings (text-embedding-3-small)" input="$0.02" output="—" last />
            </tbody>
          </table>
        </div>
        <P>
          Prompt caching reduces costs: the cache-read discount depends on the
          model.
        </P>
        <P>
          For Claude Sonnet 5.5, the Octopus Cloud rate is $4 per 1M uncached
          input tokens and $20 per 1M output tokens, including thinking. Cache
          reads cost $0.40 per 1M tokens; cache writes cost $5 for a five-minute
          cache or $8 for a one-hour cache. A request using 20,000 uncached input
          tokens and 2,000 output tokens costs $0.12. This is an example, not a
          fixed review price: a review can make multiple AI calls, and indexing
          and other operations have their own usage costs.
        </P>
      </Section>

      {/* Cost per review */}
      <Section id="what-a-review-costs" title="What a review costs">
        <P>
          These figures come from real reviews on Octopus Cloud in the 30 days
          up to 14 November 2026. They are the amounts charged on platform keys,
          so they already include the 2x platform rate on the provider&apos;s
          list price.
        </P>
        <P>
          We split the reviews into thirds by how much the reviewer had to read:
          the change plus the repository context it pulled in. Each figure is
          the median charge in that third.
        </P>
        <div className="mb-4 overflow-x-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-4 py-2 font-medium text-[#999]">Model</th>
                <th className="px-4 py-2 text-right font-medium text-[#999]">Smaller third</th>
                <th className="px-4 py-2 text-right font-medium text-[#999]">Middle third</th>
                <th className="px-4 py-2 text-right font-medium text-[#999]">Larger third</th>
              </tr>
            </thead>
            <tbody className="text-[#888]">
              {REVIEW_COSTS.map(([model, smaller, middle, larger], index) => (
                <tr key={model} className={index === REVIEW_COSTS.length - 1 ? "" : "border-b border-white/[0.04]"}>
                  <td className="px-4 py-2 text-[#ccc]">{model}</td>
                  <td className="px-4 py-2 text-right">{smaller}</td>
                  <td className="px-4 py-2 text-right">{middle}</td>
                  <td className="px-4 py-2 text-right">{larger}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Supporting steps that run with a review, such as re-ranking context
          and validating findings, add about $0.07 per review on average.
        </P>
        <P>
          These are typical amounts. They are not fixed prices. A median is the
          middle value, so about half the reviews in each third cost more than
          the figure shown. An unusually large pull request costs more. Prices
          follow the providers&apos; list prices, so these amounts change when a
          provider changes its rates.
        </P>
        <P>
          Every AI operation is logged, and you can see your own usage breakdown
          in the billing settings.
        </P>
        <P>
          With your own provider API key, Octopus does not bill the model call
          at all. Your provider bills you directly. Operations that still run on
          platform providers, such as embeddings, continue to use credits.
        </P>
      </Section>

      {/* Credits */}
      <Section title="Credits & Billing">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <FeatureCard
            icon={<IconSparkles className="size-4" />}
            title="Free Credits"
            description="New organizations receive promotional credits. These are used first before purchased credits."
          />
          <FeatureCard
            icon={<IconCreditCard className="size-4" />}
            title="Purchase Credits"
            description="Buy credits via Stripe. All transactions are logged with receipts and balance tracking."
          />
          <FeatureCard
            icon={<IconRefresh className="size-4" />}
            title="Auto-Reload"
            description="Configure automatic credit reload when your balance drops below a threshold. The saved-state label shows On, Off, or Paused separately from unsaved edits; the previous success message is hidden while edits are unsaved. The switch and amounts are disabled while saving. Changed saved settings received from the server update the switch and amounts; refreshes with unchanged settings preserve your draft. Saving with auto-reload enabled opens Add card if no saved card is found. Cancelling, failing, or completing card setup keeps your draft unless saved settings change. After adding a card, review your settings and select Save Auto-Reload to apply them."
          />
          <FeatureCard
            icon={<IconShieldCheck className="size-4" />}
            title="Spend Limits"
            description="Set monthly spend limits per organization. AI features pause when the limit is reached."
          />
        </div>
      </Section>

      {/* Usage tracking */}
      <Section title="Usage Tracking">
        <P>
          Every AI operation is logged with provider, model, operation type, and
          token count. You can view detailed usage breakdowns in the billing
          settings page.
        </P>
        <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center gap-3">
            <IconChartBar className="size-5 text-[#555]" />
            <div>
              <h4 className="text-sm font-medium text-white">
                Billing Dashboard
              </h4>
              <p className="mt-0.5 text-xs text-[#666]">
                Credit balance, monthly usage summary, transaction history, and
                spend limit configuration are all available in{" "}
                <Link
                  href="/settings/billing"
                  className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
                >
                  Settings &rarr; Billing
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Self-hosting */}
      <Section title="Self-Hosting">
        <P>
          When you self-host Octopus, you use your own API keys directly. There
          are no credits, no platform fees, and no billing. You only pay your
          AI provider directly for the tokens you consume.
        </P>
      </Section>

      {/* Comparison link */}
      <Section title="Comparing Options">
        <P>
          Evaluating Octopus alongside other AI code review tools? See all
          side-by-side{" "}
          <Link
            href="/compare"
            className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
          >
            comparisons
          </Link>
          {" "}including{" "}
          <Link
            href="/vs-coderabbit"
            className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
          >
            Octopus vs CodeRabbit
          </Link>
          {" "}and{" "}
          <Link
            href="/vs-greptile"
            className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
          >
            Octopus vs Greptile
          </Link>.
        </P>
      </Section>

      {/* CTA */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center">
        <h3 className="text-lg font-semibold text-white">
          Ready to get started?
        </h3>
        <p className="mt-2 text-sm text-[#888]">
          Sign up for free, no credit card required.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#e0e0e0]"
        >
          Get Started Free
        </Link>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>
  );
}

function PlanCard({
  title,
  features,
  highlight,
}: {
  title: string;
  features: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-6 ${
        highlight
          ? "border-white/[0.12] bg-white/[0.04]"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-2">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#888]">
            <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-white/20" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-[#666]">{description}</p>
    </div>
  );
}

function ModelRow({
  model,
  input,
  output,
  last,
}: {
  model: string;
  input: string;
  output: string;
  last?: boolean;
}) {
  return (
    <tr className={last ? "" : "border-b border-white/[0.04]"}>
      <td className="px-4 py-2 text-[#ccc]">{model}</td>
      <td className="px-4 py-2 text-right">{input}</td>
      <td className="px-4 py-2 text-right">{output}</td>
    </tr>
  );
}
