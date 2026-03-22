import { IconShieldLock } from "@tabler/icons-react";

export const metadata = {
  title: "Privacy Policy — Octopus",
  description: "How Octopus collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconShieldLock className="size-4" />
          Legal
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: March 2026</p>
      </div>

      <Section title="1. Introduction">
        <P>
          Octopus (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is an
          open source, AI-powered code review platform. This Privacy Policy
          explains how we collect, use, and protect your information when you
          use our cloud-hosted service. If you self-host Octopus, your own
          privacy policies apply.
        </P>
      </Section>

      <Section title="2. Information We Collect">
        <H3>Account Information</H3>
        <P>
          When you sign up, we collect your name, email address, and profile
          picture through your OAuth provider (GitHub or Google). We do not
          store passwords.
        </P>

        <H3>Repository Data</H3>
        <P>
          When you connect a repository, we access its contents through the
          GitHub or Bitbucket API to create code embeddings and perform
          reviews. We process pull request diffs, file contents, and
          repository metadata.
        </P>

        <H3>Usage Data</H3>
        <P>
          We collect anonymous usage analytics (page views, feature usage)
          through Google Analytics to improve the product. We also track AI
          token consumption per organization for billing purposes.
        </P>
      </Section>

      <Section title="3. How We Use Your Information">
        <UL>
          <li>To provide AI-powered code reviews on your pull requests</li>
          <li>To create and maintain code embeddings for context-aware reviews</li>
          <li>To authenticate you and manage your organization membership</li>
          <li>To track usage and enforce spend limits</li>
          <li>To improve the product based on aggregated, anonymized usage patterns</li>
        </UL>
      </Section>

      <Section title="4. Code and Data Storage">
        <P>
          Code embeddings (vector representations of your code) are stored in
          Qdrant. These embeddings cannot be reverse-engineered back into
          source code. We do not permanently store your raw source code. Pull
          request diffs are processed in memory and discarded after review.
        </P>
        <P>
          Review results, findings, and AI-generated summaries are stored in
          our PostgreSQL database and associated with your organization.
        </P>
      </Section>

      <Section title="5. Third-Party Services">
        <P>We use the following third-party services to operate Octopus:</P>
        <UL>
          <li>
            <strong className="text-white">OpenAI</strong> for generating code
            embeddings (text-embedding-3-large)
          </li>
          <li>
            <strong className="text-white">Anthropic (Claude)</strong> and/or{" "}
            <strong className="text-white">OpenAI</strong> for AI-powered code
            reviews
          </li>
          <li>
            <strong className="text-white">GitHub / Bitbucket</strong> for
            repository access and webhook events
          </li>
          <li>
            <strong className="text-white">Stripe</strong> for payment
            processing (if applicable)
          </li>
          <li>
            <strong className="text-white">Google Analytics</strong> for
            anonymous usage analytics
          </li>
        </UL>
        <P>
          Code snippets sent to AI providers are subject to their respective
          privacy policies. We recommend reviewing their data handling
          practices.
        </P>
      </Section>

      <Section title="6. Data Retention">
        <P>
          We retain your data for as long as your account is active. When you
          delete your account or remove a repository, associated data
          (embeddings, reviews, analytics) is soft-deleted and permanently
          purged within 30 days.
        </P>
      </Section>

      <Section title="7. Data Security">
        <P>
          We use industry-standard security measures including encrypted
          connections (TLS), secure authentication (OAuth 2.0), and access
          controls. API keys and tokens are encrypted at rest.
        </P>
      </Section>

      <Section title="8. Your Rights">
        <P>You have the right to:</P>
        <UL>
          <li>Access and export your data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Disconnect repositories at any time</li>
          <li>Opt out of analytics tracking</li>
        </UL>
        <P>
          For any privacy-related requests, open an issue on our GitHub
          repository or contact us directly.
        </P>
      </Section>

      <Section title="9. Self-Hosting">
        <P>
          Octopus is fully open source. If you self-host Octopus on your own
          infrastructure, your code never touches our servers. You are
          responsible for your own data handling and privacy compliance.
        </P>
      </Section>

      <Section title="10. Changes to This Policy">
        <P>
          We may update this policy from time to time. Changes will be posted
          on this page with an updated revision date. Continued use of the
          service after changes constitutes acceptance of the updated policy.
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

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold text-[#ccc]">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-inside list-disc space-y-1.5 text-sm text-[#888]">{children}</ul>;
}
