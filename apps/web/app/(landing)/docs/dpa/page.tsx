import { IconFileCertificate } from "@tabler/icons-react";

export const metadata = {
  title: "Data Processing Addendum — Octopus",
  description:
    "Octopus Data Processing Addendum (DPA) for GDPR / UK GDPR / CCPA compliance. Plain-language summary plus how to execute the formal DPA.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/dpa",
  },
};

export default function DpaPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconFileCertificate className="size-4" />
          Compliance
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Data Processing Addendum</h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: May 2026 · v1.0</p>
      </div>

      <Section title="In plain language">
        <P>
          A Data Processing Addendum (DPA) is the legal document that
          formalises Octopus&apos;s role as a data processor and your role as
          a data controller under GDPR / UK GDPR / CCPA. It complements (does
          not replace) our <a href="/docs/terms" className="text-cyan-400 underline">Terms of Service</a>{" "}
          and <a href="/docs/privacy" className="text-cyan-400 underline">Privacy Policy</a>.
        </P>
        <P>
          Our DPA incorporates the EU Standard Contractual Clauses (SCCs) for
          international transfers and references the{" "}
          <a href="/docs/sub-processors" className="text-cyan-400 underline">sub-processors page</a>{" "}
          as the canonical list of vendors with access to your data.
        </P>
      </Section>

      <Section title="What it covers">
        <UL>
          <li>Subject matter, duration, nature, and purpose of processing</li>
          <li>The types of personal data processed (account identifiers, repository content references, audit metadata, and — for orgs that enable Live Activity — coarse presence and activity telemetry, never content)</li>
          <li>Octopus&apos;s technical and organisational security measures (see <a href="/docs/security-overview" className="text-cyan-400 underline">Security Overview</a>)</li>
          <li>Sub-processor authorisation and notification of changes</li>
          <li>International transfer safeguards (Standard Contractual Clauses)</li>
          <li>Data subject rights handling (access, deletion, portability)</li>
          <li>Personal data breach notification (within 72 hours of confirmation)</li>
          <li>Data return / deletion at the end of the engagement</li>
        </UL>
      </Section>

      <Section title="How to execute">
        <P>
          <strong>Self-serve (most common):</strong> our standard DPA is
          incorporated by reference into our Terms of Service. Accepting the
          Terms accepts the DPA. No separate signature required.
        </P>
        <P>
          <strong>PDF copy:</strong>{" "}
          <a href="/dpa.pdf" className="text-cyan-400 underline" download>
            download the DPA template (PDF)
          </a>
          . For a <strong>counter-signed</strong> copy for your records, email{" "}
          <a href="mailto:legal@octopus-review.ai" className="text-cyan-400 underline">
            legal@octopus-review.ai
          </a>{" "}
          with your company name, the legal entity that will sign, and the
          signatory&apos;s name and email. We will return a counter-signed PDF
          within 5 business days.
        </P>
        <P>
          <strong>Custom DPA:</strong> we can review and counter-sign your
          standard DPA on best-effort basis. Material redlines are reviewed by
          our counsel; turnaround is typically 10 business days. Some changes
          (e.g. removing the SCCs, accepting unlimited liability, agreeing to a
          jurisdiction other than England &amp; Wales) we cannot make.
        </P>
      </Section>

      <Section title="Sub-processor changes">
        <P>
          Per the DPA, we will notify you of new sub-processors at least 30
          days before granting them access, unless required for security or
          incident response. Notifications go via email to the org&apos;s billing
          email and as a CHANGELOG entry. You may object in writing within 14
          days; we will work with you to find an alternative or, failing that,
          you may terminate the affected feature.
        </P>
      </Section>

      <Section title="Self-hosted Octopus">
        <P>
          When you self-host Octopus, no data leaves your infrastructure
          (unless you connect external integrations like a cloud LLM provider
          or Slack). In that arrangement Octopus is not your data processor —
          you operate the software yourself, like any self-hosted server. A
          DPA is not required for self-hosted unless you have an external
          integration that brings a third party into scope.
        </P>
      </Section>

      <Section title="Questions">
        <P>
          Legal questions:{" "}
          <a href="mailto:legal@octopus-review.ai" className="text-cyan-400 underline">
            legal@octopus-review.ai
          </a>
          . Security questions:{" "}
          <a href="mailto:security@octopus-review.ai" className="text-cyan-400 underline">
            security@octopus-review.ai
          </a>
          .
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
