import { IconClockHour4 } from "@tabler/icons-react";

export const metadata = {
  title: "Data Retention — Octopus",
  description:
    "What Octopus stores, for how long, and how to request deletion. Reviews, embeddings, audit logs, and integration tokens have explicit retention windows.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/data-retention",
  },
};

type RetentionRow = {
  category: string;
  what: string;
  retention: string;
  notes?: string;
};

const RETENTION: RetentionRow[] = [
  {
    category: "Reviews",
    what: "Posted review bodies + findings on each PR",
    retention: "For the lifetime of the PR + 90 days after PR close",
    notes: "Findings stay queryable from the dashboard during this window; after, they roll off.",
  },
  {
    category: "Diffs",
    what: "PR diff content used for a single review",
    retention: "Discarded after the review completes",
    notes: "Never persisted to durable storage.",
  },
  {
    category: "Embeddings",
    what: "Vector chunks indexed from connected repos in Qdrant",
    retention: "For as long as the repo is connected",
    notes: "On repo disconnect: vectors are deleted within 24 h.",
  },
  {
    category: "Audit log",
    what: "AuditLog rows recording mutating actions",
    retention: "365 days (hosted default)",
    notes: "Self-hosted: configurable retention window.",
  },
  {
    category: "AI usage",
    what: "Token-count records for billing and observability",
    retention: "13 months",
    notes: "Aggregated monthly summaries retained indefinitely for billing reconciliation.",
  },
  {
    category: "Integration tokens",
    what: "OAuth refresh tokens for Slack / Linear / Jira / GitLab",
    retention: "Until the user disconnects the integration",
    notes: "Stored encrypted at rest (apps/web/lib/crypto.ts).",
  },
  {
    category: "Sessions",
    what: "Auth session tokens + IP + user-agent",
    retention: "30 days from last activity",
    notes: "Revocable from /settings/sessions.",
  },
  {
    category: "Email send records",
    what: "EmailSend rows for transactional emails",
    retention: "13 months",
  },
  {
    category: "Knowledge documents",
    what: "User-uploaded knowledge base docs",
    retention: "Until the user deletes them; soft-deleted with 30-day recovery window",
  },
  {
    category: "Backups",
    what: "Encrypted DB snapshots",
    retention: "30 days for hosted; self-hosters control their own",
  },
  {
    category: "Activity events",
    what: "Live team-telemetry feed rows (coarse actions only — no content)",
    retention: "30 days (hosted default)",
    notes: "Only when an org enables Live Activity. Tunable via ACTIVITY_RETENTION_DAYS; pruned daily.",
  },
  {
    category: "Presence",
    what: "Whether a member/agent is currently online + coarse current area",
    retention: "Ephemeral — expires ~60s after going offline",
    notes: "Held in Redis with a TTL (or a short-lived DB row); never archived.",
  },
];

export default function DataRetentionPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconClockHour4 className="size-4" />
          Compliance
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Data Retention</h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: May 2026</p>
      </div>

      <P>
        This page lists what Octopus stores, for how long, and how to request
        deletion. Numbers apply to <strong>hosted</strong> Octopus by default;
        self-hosters control their own retention.
      </P>

      <Section title="Retention by category">
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-[#888]">
            <thead className="text-[#555]">
              <tr className="border-b border-[#222]">
                <th className="py-2 pr-3 font-semibold">Category</th>
                <th className="py-2 pr-3 font-semibold">What</th>
                <th className="py-2 pr-3 font-semibold">Retention</th>
              </tr>
            </thead>
            <tbody>
              {RETENTION.map((r) => (
                <tr key={r.category} className="border-b border-[#191919] align-top">
                  <td className="py-2 pr-3 font-medium text-[#ccc]">{r.category}</td>
                  <td className="py-2 pr-3">
                    {r.what}
                    {r.notes ? <div className="mt-1 text-[11px] text-[#666]">{r.notes}</div> : null}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{r.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Account / organisation deletion">
        <P>
          Org owners can delete their organisation from the <em>Danger Zone</em>{" "}
          card on <code>/settings</code>. Deletion is processed within 24 hours
          and removes:
        </P>
        <UL>
          <li>The organisation record, all repos, reviews, embeddings, audit log, and integration tokens</li>
          <li>Memberships for every member of that organisation</li>
        </UL>
        <P>
          To delete your <em>user</em> record (and memberships in orgs you do
          not solely own), email{" "}
          <a href="mailto:privacy@octopus-review.ai" className="text-cyan-400 underline">
            privacy@octopus-review.ai
          </a>{" "}
          from the address on the account — the in-app flow only covers org
          deletion today.
        </P>
        <P>
          Backups containing deleted data roll off per the backup retention
          window (30 days). Anonymised aggregate metrics may persist indefinitely.
        </P>
      </Section>

      <Section title="Data export (right to portability)">
        <P>
          For org-wide data export (repositories, reviews, findings, knowledge
          documents, audit logs, AI usage records), email{" "}
          <a href="mailto:privacy@octopus-review.ai" className="text-cyan-400 underline">
            privacy@octopus-review.ai
          </a>{" "}
          from the account address — we respond within 30 days.
        </P>
      </Section>

      <Section title="GDPR / CCPA requests">
        <P>
          Right-to-access, right-to-erasure, right-to-portability, and
          right-to-correction requests can be made by emailing{" "}
          <a href="mailto:privacy@octopus-review.ai" className="text-cyan-400 underline">
            privacy@octopus-review.ai
          </a>{" "}
          from the address on the affected account. We respond within 30 days.
        </P>
      </Section>

      <Section title="Self-hosters">
        <P>
          Self-hosted Octopus stores everything in your PostgreSQL + Qdrant +
          object-storage. There is no automatic retention beyond the
          90-day-post-close window for review findings. Configure retention for
          your stored data per your own compliance requirements.
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
