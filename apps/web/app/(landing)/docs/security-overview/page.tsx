import { IconShieldCheck } from "@tabler/icons-react";

export const metadata = {
  title: "Security Overview — Octopus",
  description:
    "How Octopus stores, processes, and protects your source code and credentials — data flow, encryption, access controls, audit logging, and incident response.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/security-overview",
  },
};

export default function SecurityOverviewPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconShieldCheck className="size-4" />
          Security
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Security Overview</h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: May 2026</p>
      </div>

      <Section title="1. Data flow at a glance">
        <P>
          Octopus reviews pull requests in five stages. Each stage runs inside the
          customer&apos;s VPC tenancy (hosted Octopus) or the customer&apos;s own
          infrastructure (self-hosted Octopus).
        </P>
        <UL>
          <li><strong>Webhook</strong> — GitHub, GitLab, or Bitbucket POSTs a PR/MR event; we verify the HMAC signature before processing.</li>
          <li><strong>Clone</strong> — we clone the repository into a per-job temporary directory; never persisted beyond the job.</li>
          <li><strong>Index</strong> — file contents are chunked and embedded into Qdrant for vector search. Source files are not stored as plaintext outside the indexing window.</li>
          <li><strong>Review</strong> — relevant chunks plus the diff are sent to the configured LLM provider. Provider choice and BYOK key live on the organisation.</li>
          <li><strong>Comment</strong> — findings are posted as inline review comments on the PR/MR via the platform API.</li>
        </UL>
      </Section>

      <Section title="2. Encryption">
        <H3>In transit</H3>
        <P>
          All HTTP traffic uses TLS 1.2 or higher. Webhook payloads, dashboard
          traffic, and LLM provider calls are all TLS-terminated either at the
          edge (hosted) or at the customer&apos;s reverse proxy (self-hosted).
        </P>
        <H3>At rest</H3>
        <UL>
          <li>PostgreSQL — full-disk encryption on the underlying volume.</li>
          <li>Qdrant vector store — full-disk encryption on the underlying volume.</li>
          <li>Object storage (S3 / R2) for org avatars and large review payloads — server-side encryption with provider-managed keys.</li>
          <li>OAuth tokens for third-party integrations (Slack, Linear, Jira, GitLab) are stored encrypted at the row level using an AES-256 key derived from the application secret. See <code>apps/web/lib/crypto.ts</code>.</li>
        </UL>
      </Section>

      <Section title="3. Secrets handling">
        <P>
          BYOK API keys (Anthropic / OpenAI / Google / Cohere / Grok /
          OpenRouter / ACPX / OpenCode) are stored as nullable columns on the
          Organization row, accessible only through the AI router on the
          server. They are never returned over the API, never logged, and
          never sent to the LLM provider as anything other than an HTTP
          Authorization header on the request that uses them.
        </P>
        <P>
          The platform&apos;s own API keys (when not using BYOK) live in
          environment variables and are accessed only by the API routes that
          need them. The hosted dashboard never receives them; the self-hosted
          dashboard accesses them through the same server-side router.
        </P>
      </Section>

      <Section title="4. Access controls">
        <UL>
          <li><strong>Authentication</strong> — Better Auth with GitHub OAuth, Google OAuth, and magic-link email. Passwords are not used; we have no password store.</li>
          <li><strong>Session management</strong> — short-lived bearer tokens with refresh; sessions revocable from <code>/settings/sessions</code>.</li>
          <li><strong>Role-based access</strong> — per-organisation roles (owner / admin / member); the audit log records role transitions.</li>
          <li><strong>CLI tokens</strong> — issued via the device-code flow, scoped to one organisation, revocable per-token.</li>
          <li><strong>Webhook secrets</strong> — set per-organisation; HMAC verification on every inbound payload.</li>
        </UL>
      </Section>

      <Section title="5. Audit logging">
        <P>
          Mutating actions are recorded in the <code>AuditLog</code> table
          (org membership changes, settings edits, integration installs and
          revocations, API token creation/deletion, knowledge document
          changes, billing actions, …). Each entry records the actor, the
          targeted resource, the operation, the IP and user-agent, and a
          JSON metadata blob.
        </P>
        <P>
          Org admins can view and export their audit log from{" "}
          <code>/settings/audit-log</code>. Hosted Octopus retains audit
          entries for 365 days by default; self-hosters can configure this
          per their compliance requirements.
        </P>
      </Section>

      <Section title="6. Network egress">
        <P>
          Octopus makes outbound calls to:
        </P>
        <UL>
          <li>The configured LLM provider for each org (Anthropic / OpenAI / Google / etc.)</li>
          <li>The git platform API (GitHub / GitLab / Bitbucket) for clone, comment, and webhook acknowledgement</li>
          <li>Integration webhooks if configured (Slack / Linear / Jira)</li>
          <li>Email provider (Resend) for notifications</li>
          <li>OAuth providers during sign-in (GitHub / Google)</li>
        </UL>
        <P>
          See the <a href="/docs/sub-processors" className="text-cyan-400 underline">sub-processors page</a> for the full vendor list.
        </P>
      </Section>

      <Section title="7. Incident response">
        <P>
          On confirming a security incident, we follow this sequence:
        </P>
        <UL>
          <li>Contain — disable the affected component or revoke the affected credential within 1 hour of confirmation.</li>
          <li>Investigate — preserve logs, identify scope, identify affected customers.</li>
          <li>Notify — email affected customers within 72 hours of confirming impact, with the facts known at the time.</li>
          <li>Remediate — ship the fix, update documentation, update the changelog.</li>
          <li>Post-mortem — publish a public post-mortem within 30 days for incidents with customer impact.</li>
        </UL>
      </Section>

      <Section title="8. Related">
        <UL>
          <li><a href="/docs/privacy" className="text-cyan-400 underline">Privacy Policy</a> — what we collect</li>
          <li><a href="/docs/sub-processors" className="text-cyan-400 underline">Sub-processors</a> — third-party vendors</li>
          <li><a href="/docs/dpa" className="text-cyan-400 underline">DPA</a> — Data Processing Addendum</li>
          <li><a href="/docs/data-retention" className="text-cyan-400 underline">Data Retention</a> — what we store, for how long</li>
          <li><a href="/docs/security" className="text-cyan-400 underline">Security Policy &amp; Bug Bounty</a> — vulnerability disclosure</li>
        </UL>
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
