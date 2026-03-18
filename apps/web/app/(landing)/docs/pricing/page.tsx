import Link from "next/link";
import {
  IconSparkles,
  IconCreditCard,
  IconKey,
  IconShieldCheck,
  IconRefresh,
  IconChartBar,
} from "@tabler/icons-react";

export const metadata = {
  title: "Pricing — Octopus Docs",
  description:
    "Octopus pricing, credits, and usage-based billing. Free to start, pay only for what you use.",
};

export default function PricingPage() {
  return (
    <article className="max-w-3xl">
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
          and pay nothing.
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
              "All features included",
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
      </Section>

      {/* BYO Keys */}
      <Section title="Bring Your Own Keys">
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
                Configure your own Anthropic, OpenAI, Google, or Cohere API keys
                in the organization settings. When you bring your own keys,
                Octopus routes requests directly to your provider account and no
                credits are deducted.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {["Anthropic", "OpenAI", "Google AI", "Cohere"].map((p) => (
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
      <Section title="Model Pricing">
        <P>
          Credit consumption varies by model. A 20% platform fee is applied on
          top of provider costs. Below are the base prices per 1M tokens:
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
              <ModelRow model="Claude Sonnet 4.6" input="$3" output="$15" />
              <ModelRow model="Claude Haiku 4.5" input="$1" output="$5" />
              <ModelRow model="GPT-4o" input="$2.50" output="$10" />
              <ModelRow model="GPT-4o Mini" input="$0.15" output="$0.60" />
              <ModelRow model="Embeddings (text-embedding-3-large)" input="$0.13" output="—" />
              <ModelRow model="Cohere Rerank" input="$2/1K queries" output="—" last />
            </tbody>
          </table>
        </div>
        <P>
          Prompt caching reduces costs: cached reads are billed at 10% of the
          input price.
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
            description="Configure automatic credit reload when your balance drops below a threshold."
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
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]"
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
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
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
