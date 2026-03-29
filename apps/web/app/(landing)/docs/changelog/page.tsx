import fs from "node:fs";
import path from "node:path";
import {
  IconHistory,
  IconPlus,
  IconBug,
  IconRefresh,
  IconTrash,
  IconAlertTriangle,
  IconShield,
  IconTag,
  IconExternalLink,
} from "@tabler/icons-react";

export const metadata = {
  title: "Changelog | Octopus Docs",
  description:
    "See what's new in Octopus — new features, bug fixes, and improvements across every release.",
};

/* ------------------------------------------------------------------ */
/* Markdown parser                                                     */
/* ------------------------------------------------------------------ */

interface ChangelogEntry {
  version: string;
  date: string;
  compareUrl: string | null;
  sections: { heading: string; items: string[] }[];
}

function parseChangelog(raw: string): ChangelogEntry[] {
  const lines = raw.split("\n");
  const entries: ChangelogEntry[] = [];

  // Collect compare links from bottom
  const links = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]:\s*(.+)$/);
    if (m) links.set(m[1], m[2]);
  }

  let current: ChangelogEntry | null = null;
  let currentSection: { heading: string; items: string[] } | null = null;

  for (const line of lines) {
    // Version heading: ## [1.0.5] - 2026-03-29
    const versionMatch = line.match(/^## \[([^\]]+)\]\s*-\s*(.+)$/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        date: versionMatch[2].trim(),
        compareUrl: links.get(versionMatch[1]) ?? null,
        sections: [],
      };
      currentSection = null;
      continue;
    }

    // Section heading: ### Added
    const sectionMatch = line.match(/^### (.+)$/);
    if (sectionMatch && current) {
      currentSection = { heading: sectionMatch[1], items: [] };
      current.sections.push(currentSection);
      continue;
    }

    // List item: - Something (#42)
    if (line.startsWith("- ") && currentSection) {
      currentSection.items.push(line.slice(2));
    }
  }
  if (current) entries.push(current);

  return entries;
}

function formatItem(text: string): React.ReactNode {
  // Convert (#123) to GitHub links
  const parts = text.split(/(\(#\d+\))/g);
  return parts.map((part, i) => {
    const prMatch = part.match(/^\(#(\d+)\)$/);
    if (prMatch) {
      return (
        <a
          key={i}
          href={`https://github.com/octopusreview/octopus/pull/${prMatch[1]}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-[#10D8BE]/70 transition-colors hover:text-[#10D8BE]"
        >
          #{prMatch[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/* ------------------------------------------------------------------ */
/* Section icons & colors                                              */
/* ------------------------------------------------------------------ */

const sectionMeta: Record<
  string,
  { icon: typeof IconPlus; color: string; bg: string }
> = {
  Added: {
    icon: IconPlus,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  Fixed: {
    icon: IconBug,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  Changed: {
    icon: IconRefresh,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  Removed: {
    icon: IconTrash,
    color: "text-red-400",
    bg: "bg-red-400/10",
  },
  Deprecated: {
    icon: IconAlertTriangle,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
  },
  Security: {
    icon: IconShield,
    color: "text-rose-400",
    bg: "bg-rose-400/10",
  },
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ChangelogPage() {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "../../CHANGELOG.md"),
    "utf-8",
  );
  const entries = parseChangelog(raw);

  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconHistory className="size-4" />
          Changelog
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          What&apos;s New
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          New features, bug fixes, and improvements across every release.
        </p>
      </div>

      <div className="relative space-y-8">
        {/* Timeline line */}
        <div className="absolute bottom-0 left-[15px] top-2 w-px bg-white/[0.06] max-sm:hidden" />

        {entries.map((entry, idx) => (
          <div key={entry.version} className="relative sm:pl-10">
            {/* Timeline dot */}
            <div
              className={`absolute left-[11px] top-1.5 size-[9px] rounded-full max-sm:hidden ${
                idx === 0
                  ? "bg-[#10D8BE] shadow-[0_0_8px_rgba(16,216,190,0.4)]"
                  : "bg-white/20"
              }`}
            />

            {/* Version header */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <IconTag className="size-4 text-[#555]" />
                <h2 className="text-xl font-bold text-white">
                  v{entry.version}
                </h2>
              </div>
              <time className="text-sm text-[#555]">{entry.date}</time>
              {entry.compareUrl && (
                <a
                  href={entry.compareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-[#444] transition-colors hover:text-[#10D8BE]"
                >
                  <IconExternalLink className="size-3" />
                  Compare
                </a>
              )}
            </div>

            {/* Sections */}
            <div className="space-y-4">
              {entry.sections.map((section) => {
                const meta = sectionMeta[section.heading] ?? {
                  icon: IconRefresh,
                  color: "text-[#888]",
                  bg: "bg-white/[0.04]",
                };
                const Icon = meta.icon;

                return (
                  <div
                    key={section.heading}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                      <div
                        className={`flex size-6 items-center justify-center rounded-md ${meta.bg}`}
                      >
                        <Icon className={`size-3.5 ${meta.color}`} />
                      </div>
                      <span
                        className={`text-sm font-semibold ${meta.color}`}
                      >
                        {section.heading}
                      </span>
                      <span className="text-xs text-[#444]">
                        {section.items.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-white/[0.04] px-4">
                      {section.items.map((item, j) => (
                        <li
                          key={j}
                          className="py-2.5 text-sm leading-relaxed text-[#999]"
                        >
                          {formatItem(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
