import Link from "@/components/link";
import { IconTrophy } from "@tabler/icons-react";

export const metadata = {
  title: "Security Hall of Fame — Octopus",
  description:
    "Recognition for security researchers who responsibly disclosed vulnerabilities to Octopus.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/security/hall-of-fame",
  },
};

type Researcher = {
  name: string;
  handle?: string;
  url?: string;
  date: string;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
};

const researchers: Researcher[] = [];

export default function HallOfFamePage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconTrophy className="size-4" />
          Security
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Security Hall of Fame
        </h1>
        <p className="mt-3 text-sm text-[#555]">
          Researchers who helped keep Octopus safe through responsible disclosure.
        </p>
      </div>

      {researchers.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
          <p className="text-sm text-[#888]">
            No reports yet. Be the first — see our{" "}
            <Link
              href="/docs/security"
              className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
            >
              security policy
            </Link>{" "}
            for details.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {researchers.map((r, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
                    >
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )}
                  {r.handle && <span className="text-[#666]">{r.handle}</span>}
                </div>
                <p className="mt-1 text-xs text-[#888]">{r.summary}</p>
              </div>
              <div className="text-right">
                <SeverityBadge severity={r.severity} />
                <div className="mt-1 text-[10px] text-[#555]">{r.date}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SeverityBadge({ severity }: { severity: Researcher["severity"] }) {
  const styles: Record<Researcher["severity"], string> = {
    critical: "bg-red-500/10 text-red-300",
    high: "bg-orange-500/10 text-orange-300",
    medium: "bg-yellow-500/10 text-yellow-300",
    low: "bg-blue-500/10 text-blue-300",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles[severity]}`}
    >
      {severity}
    </span>
  );
}
