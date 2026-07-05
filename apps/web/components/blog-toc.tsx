"use client";

import { useEffect, useState } from "react";
import type { TocHeading } from "@/lib/blog-reading";

export function BlogToc({ headings }: { headings: TocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Trigger the "active" swap once a heading passes just below the fixed nav.
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    for (const { id } of headings) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  // Not worth a TOC for a one- or two-heading post.
  if (headings.length < 2) return null;

  return (
    <nav aria-label="Table of contents" className="text-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
        On this page
      </p>
      <ul className="space-y-1 border-l border-white/[0.08]">
        {headings.map((h) => (
          <li key={h.id} className={h.depth === 3 ? "pl-3" : ""}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l-2 py-1 pl-3 transition-colors ${
                activeId === h.id
                  ? "border-[#10D8BE] text-white"
                  : "border-transparent text-[#666] hover:text-[#aaa]"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
