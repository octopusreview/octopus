"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconArrowUp } from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";

type TocEntry = { id: string; text: string };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

export function DocsToc() {
  const pathname = usePathname();
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;

    const headings = Array.from(
      main.querySelectorAll<HTMLHeadingElement>("h2")
    );

    const seen = new Set<string>();
    const next: TocEntry[] = headings.map((h) => {
      const text = (h.textContent ?? "").trim();
      const base = h.id || slugify(text);
      let id = base;
      let i = 2;
      while (seen.has(id)) {
        id = `${base}-${i++}`;
      }
      seen.add(id);
      if (!h.id) h.id = id;
      h.style.scrollMarginTop = "5rem";
      return { id, text };
    });

    setEntries(next);
    setActiveId(next[0]?.id ?? null);

    if (next.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -70% 0px",
        threshold: 0,
      }
    );

    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [pathname]);

  if (entries.length < 2) return null;

  return (
    <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pl-4">
      <button
        type="button"
        onClick={() => {
          trackEvent("docs_toc_scroll_top");
          window.scrollTo({ top: 0, behavior: "instant" });
        }}
        className="mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#666] transition-colors hover:bg-white/[0.04] hover:text-white"
        aria-label="Scroll to top"
      >
        <IconArrowUp className="size-3.5" />
        Top
      </button>
      <ul className="space-y-1 border-l border-white/[0.06]">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <li key={entry.id} className="relative">
              {active && (
                <span className="absolute -left-px top-0 h-full w-px bg-white" />
              )}
              <a
                href={`#${entry.id}`}
                className={`block py-1 pl-4 pr-2 text-sm leading-snug transition-colors ${
                  active
                    ? "text-white"
                    : "text-[#666] hover:text-white"
                }`}
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
