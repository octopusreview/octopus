import Link from "next/link";
import { IconQuestionMark } from "@tabler/icons-react";
import { FaqAccordion } from "./faq-accordion";

export const metadata = {
  title: "FAQ — Octopus Docs",
  description:
    "Answers to the most common questions about AI code review with Octopus. Pricing, security, language support, self-hosting, integrations, and more.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/faq",
  },
};

const generalFaqs = [
  {
    q: "What is Octopus?",
    a: "Octopus is an AI-powered code review tool. It connects to your GitHub or Bitbucket repositories, indexes your codebase, and automatically reviews pull requests — posting findings as inline comments with severity levels.",
  },
  {
    q: "How does Octopus review my code?",
    a: "When a pull request is opened, Octopus fetches the diff, retrieves relevant context from your indexed codebase using vector search, and sends it to an LLM (Claude or OpenAI) for analysis. The results are posted as PR comments with severity indicators: 🔴 Critical, 🟠 Major, 🟡 Minor, 🔵 Suggestion, 💡 Tip.",
  },
  {
    q: "Which programming languages does Octopus support?",
    a: "Octopus is language-agnostic. It reviews any text-based code file — TypeScript, Python, Go, Rust, Java, C#, Ruby, PHP, Swift, Kotlin, and more. Since it uses LLMs for analysis, it understands the semantics and patterns of virtually any language.",
  },
  {
    q: "Does Octopus replace human code reviewers?",
    a: "No. Octopus is designed to augment your team's review process, not replace it. It catches bugs, security issues, and style inconsistencies so your human reviewers can focus on architecture, design decisions, and business logic.",
  },
  {
    q: "How is Octopus different from linters or static analysis tools?",
    a: "Linters check syntax and formatting rules. Static analysis tools look for known code patterns. Octopus goes further — it understands your codebase context, reads your documentation and coding standards, and provides semantic-level feedback similar to what an experienced developer would give.",
  },
];

const securityFaqs = [
  {
    q: "Is my code safe?",
    a: "Yes. Your code is processed in-memory and never stored permanently on our servers. Embeddings are stored in your Qdrant instance for search, but the original source code is not retained. If you self-host, everything stays on your own infrastructure.",
  },
  {
    q: "Can I self-host Octopus?",
    a: "Absolutely. Octopus is open source (MIT license) and fully self-hostable. You can deploy it with Docker on your own infrastructure — your code never leaves your servers. See the Self-Hosting documentation for setup instructions.",
  },
  {
    q: "Which AI models process my code?",
    a: "Octopus supports Anthropic Claude and OpenAI models. You can configure which model your organization uses, or bring your own API keys (BYO keys) so requests go directly to the provider without any intermediary.",
  },
  {
    q: "Does Octopus train AI models on my code?",
    a: "No. Your code is never used for training. When using the cloud service, code is sent to Anthropic or OpenAI via their API, which does not use API inputs for model training. When self-hosting, you control the entire pipeline.",
  },
];

const integrationFaqs = [
  {
    q: "Which Git platforms are supported?",
    a: "Octopus integrates with GitHub (including GitHub Enterprise) and Bitbucket. It installs as a GitHub App or connects via Bitbucket OAuth, and listens for pull request webhooks.",
  },
  {
    q: "Can I connect Octopus to Slack?",
    a: "Yes. The Slack integration lets you ask questions about your codebase directly in Slack channels. Octopus uses your indexed code and knowledge base to provide context-aware answers.",
  },
  {
    q: "Does Octopus integrate with Linear?",
    a: "Yes. You can connect Octopus to Linear to automatically create issues from review findings. This makes it easy to track and prioritize the issues Octopus discovers.",
  },
  {
    q: "Can I use Octopus with a monorepo?",
    a: <>Yes. Octopus indexes the entire repository and understands cross-package dependencies. You can use <Link href="/docs/octopusignore" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">.octopusignore</Link> to exclude directories that shouldn&apos;t be reviewed (build outputs, vendor code, etc.).</>,
  },
  {
    q: "Is there a CLI?",
    a: "Yes. The Octopus CLI lets you trigger reviews, index repositories, check usage, and chat with your codebase — all from the terminal. Install it with npm install -g @octp/cli.",
  },
];

const pricingFaqs = [
  {
    q: "How does pricing work?",
    a: "Octopus uses a credit-based system. Each review, indexing operation, and chat message consumes credits based on token usage. You can purchase credits or bring your own API keys to use your existing provider billing directly.",
  },
  {
    q: "Is there a free tier?",
    a: "Yes. Every organization gets free credits to get started. This is enough to try Octopus on a few repositories and see the value before committing to a paid plan.",
  },
  {
    q: "What are BYO (Bring Your Own) keys?",
    a: "BYO keys let you use your own Anthropic or OpenAI API keys. This way, AI usage is billed directly to your provider account, and you only pay Octopus for the platform — not the AI tokens.",
  },
  {
    q: "Can I set spend limits?",
    a: "Yes. Each organization can configure monthly spend limits. Octopus checks the limit before every expensive operation and stops processing if you're over budget — no surprise bills.",
  },
];

const technicalFaqs = [
  {
    q: "How does codebase indexing work?",
    a: "Octopus fetches your repository contents via the Git provider API, splits the code into overlapping chunks (1500 characters with 200 character overlap), generates vector embeddings, and stores them in Qdrant. The original source code is processed in-memory and not retained — only the embeddings are persisted. This enables fast, semantic code search during reviews.",
  },
  {
    q: "What is the Knowledge Base?",
    a: "The Knowledge Base lets you upload documents (coding standards, architecture docs, style guides) that Octopus references during reviews. This helps it give feedback that's consistent with your team's specific conventions and requirements.",
  },
  {
    q: "How long does a review take?",
    a: "Most reviews complete in 30–90 seconds depending on the size of the diff and the complexity of the changes. Large PRs with hundreds of files may take a few minutes.",
  },
  {
    q: "Can I customize what Octopus reviews?",
    a: <>Yes. Create a <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#ccc]">.octopusignore</code> file at the root of your repository to exclude files and directories — it uses the same syntax as .gitignore. You can also configure severity thresholds and focus areas through your organization settings. See the <Link href="/docs/octopusignore" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">.octopusignore reference</Link> for details.</>,
  },
  {
    q: "Does Octopus support real-time updates?",
    a: "Yes. The dashboard uses WebSocket connections to provide real-time updates when reviews complete, repositories are indexed, or new findings are discovered. You'll see results as they happen.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    ...generalFaqs,
    ...securityFaqs,
    ...integrationFaqs.filter((f) => typeof f.a === "string"),
    ...pricingFaqs,
    ...technicalFaqs.filter((f) => typeof f.a === "string"),
  ].map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: f.a,
    },
  })),
};

export default function FaqPage() {
  return (
    <article className="max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/<\/script>/gi, "<\\/script>") }}
      />
      <div className="mb-10">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconQuestionMark className="size-4" />
          FAQ
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Frequently Asked Questions
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Everything you need to know about Octopus.
        </p>
      </div>

      <FaqAccordion
        sections={[
          { title: "General", items: generalFaqs },
          { title: "Security & Privacy", items: securityFaqs },
          { title: "Integrations", items: integrationFaqs },
          { title: "Pricing & Billing", items: pricingFaqs },
          { title: "Technical", items: technicalFaqs },
        ]}
      />
    </article>
  );
}
