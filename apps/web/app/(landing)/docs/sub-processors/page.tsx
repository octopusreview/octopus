import { IconBuildingBank } from "@tabler/icons-react";

export const metadata = {
  title: "Sub-processors — Octopus",
  description:
    "Third-party vendors with potential access to Octopus customer data, what they're used for, and where they store data.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/sub-processors",
  },
};

type Subprocessor = {
  name: string;
  purpose: string;
  dataAccessed: string;
  location: string;
  required: "always" | "conditional" | "self-host-only";
  url: string;
};

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "AWS (us-east-1)",
    purpose: "Hosted infrastructure: web application, API, PostgreSQL, Qdrant, object storage",
    dataAccessed: "All customer data on the hosted Octopus instance",
    location: "United States",
    required: "always",
    url: "https://aws.amazon.com/compliance/data-privacy/",
  },
  {
    name: "Anthropic",
    purpose: "Claude LLM for code review and Q&A",
    dataAccessed: "Diff content + retrieved code context for orgs that use Claude with platform keys (not used when org has BYOK Anthropic key with their own data-handling agreement)",
    location: "United States",
    required: "conditional",
    url: "https://www.anthropic.com/legal/privacy",
  },
  {
    name: "OpenAI",
    purpose: "GPT/Codex LLM for code review, plus OpenAI embeddings for vector indexing",
    dataAccessed: "Diff content + retrieved code context + repository chunks for embeddings",
    location: "United States",
    required: "conditional",
    url: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "Google (AI Studio)",
    purpose: "Gemini LLM for code review",
    dataAccessed: "Diff content + retrieved code context for orgs that use Gemini",
    location: "United States",
    required: "conditional",
    url: "https://policies.google.com/privacy",
  },
  {
    name: "Cohere",
    purpose: "Rerank API for retrieval result reranking",
    dataAccessed: "Repository chunk previews and the query string used for retrieval",
    location: "Canada",
    required: "conditional",
    url: "https://cohere.com/privacy",
  },
  {
    name: "Resend",
    purpose: "Transactional email (welcome, daily summary, security notifications)",
    dataAccessed: "Recipient email address + email body",
    location: "United States",
    required: "always",
    url: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Stripe",
    purpose: "Payment processing for paid plans",
    dataAccessed: "Billing email, card metadata (Stripe holds the actual card data), invoices",
    location: "United States",
    required: "conditional",
    url: "https://stripe.com/privacy",
  },
  {
    name: "Cloudflare R2",
    purpose: "Object storage for organisation avatars",
    dataAccessed: "Uploaded image files",
    location: "Multi-region",
    required: "always",
    url: "https://www.cloudflare.com/privacypolicy/",
  },
  {
    name: "GitHub",
    purpose: "Repository hosting, webhooks, OAuth, GitHub App installation",
    dataAccessed: "Org and repo metadata, PR diffs, issue references — under the customer's own GitHub agreement",
    location: "United States",
    required: "conditional",
    url: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
  },
  {
    name: "GitLab",
    purpose: "Repository hosting (Cloud or self-managed), webhooks, OAuth",
    dataAccessed: "Same as GitHub, under the customer's own GitLab agreement",
    location: "Varies (customer-controlled for self-managed)",
    required: "conditional",
    url: "https://about.gitlab.com/privacy/",
  },
  {
    name: "Bitbucket",
    purpose: "Repository hosting, webhooks, OAuth",
    dataAccessed: "Same as GitHub, under the customer's own Atlassian agreement",
    location: "Varies",
    required: "conditional",
    url: "https://www.atlassian.com/legal/privacy-policy",
  },
  {
    name: "Slack",
    purpose: "Slack integration — posting review notifications, answering Q&A from Slack",
    dataAccessed: "Channel + message content for the integration's bot interactions",
    location: "United States",
    required: "conditional",
    url: "https://slack.com/trust/privacy/privacy-policy",
  },
  {
    name: "Linear",
    purpose: "Create issues from review findings",
    dataAccessed: "Finding title + description + reference URL",
    location: "United States",
    required: "conditional",
    url: "https://linear.app/legal/privacy",
  },
  {
    name: "Pubby",
    purpose: "Real-time messaging (WebSocket pub/sub) for live chat streaming and the Live Activity dashboard",
    dataAccessed: "Coarse real-time events only (e.g. \"a review completed\") for orgs that enable Live Activity — never file contents, PR titles, or message text; durable activity is stored in our own DB, not Pubby",
    location: "United States",
    required: "conditional",
    url: "https://pubby.dev",
  },
  {
    name: "Atlassian (Jira)",
    purpose: "Create issues from review findings",
    dataAccessed: "Finding title + description + reference URL",
    location: "Varies",
    required: "conditional",
    url: "https://www.atlassian.com/legal/privacy-policy",
  },
];

export default function SubprocessorsPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconBuildingBank className="size-4" />
          Compliance
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Sub-processors</h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: May 2026</p>
      </div>

      <P>
        These are the third-party vendors with potential access to customer data
        on hosted Octopus. <strong>Self-hosted Octopus has none of these</strong>{" "}
        by default — your data stays within your own infrastructure unless you
        explicitly configure an integration that needs an external vendor (e.g.
        Slack notifications or a non-self-hosted LLM provider).
      </P>

      <P>
        Required status:
      </P>
      <UL>
        <li><strong>always</strong> — needed for the hosted service to function at all</li>
        <li><strong>conditional</strong> — only when the customer uses the feature</li>
        <li><strong>self-host-only</strong> — only when the customer deploys the self-hosted version</li>
      </UL>

      <Section title="Current sub-processors">
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-[#888]">
            <thead className="text-[#555]">
              <tr className="border-b border-[#222]">
                <th className="py-2 pr-3 font-semibold">Vendor</th>
                <th className="py-2 pr-3 font-semibold">Purpose</th>
                <th className="py-2 pr-3 font-semibold">Required</th>
                <th className="py-2 pr-3 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-b border-[#191919] align-top">
                  <td className="py-2 pr-3 font-medium text-[#ccc]">
                    <a href={s.url} className="text-cyan-400 underline" target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{s.purpose}</td>
                  <td className="py-2 pr-3 capitalize">{s.required}</td>
                  <td className="py-2 pr-3">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Change notifications">
        <P>
          We notify customers of additions or material changes to this list via
          email and a CHANGELOG entry at least 30 days before the change takes
          effect, unless the change is required for security or a vendor outage.
        </P>
      </Section>

      <Section title="Data residency">
        <P>
          Hosted Octopus runs in AWS us-east-1. We do not currently offer
          regional residency options. Self-host if your compliance requirements
          mandate data residency in a specific region.
        </P>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-inside list-disc space-y-1.5 text-sm text-[#888]">{children}</ul>;
}
