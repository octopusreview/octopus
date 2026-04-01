"use client";

import { useState } from "react";
import { IconQuestionMark, IconChevronDown } from "@tabler/icons-react";

interface FaqItem {
  q: string;
  a: string;
}

export function FaqList({ faqs, visibleCount = 3 }: { faqs: FaqItem[]; visibleCount?: number }) {
  const [open, setOpen] = useState(false);
  const safeVisibleCount = Math.max(1, visibleCount);
  const visible = faqs.slice(0, safeVisibleCount);
  const hidden = faqs.slice(safeVisibleCount);

  if (faqs.length === 0) return null;

  return (
    <>
      <dl className="mt-14 space-y-8">
        {visible.map((faq) => (
          <FaqCard key={`faq-${faqs.indexOf(faq)}`} faq={faq} />
        ))}

        {/* Hidden FAQs — always in DOM for SEO, animated open/close */}
        {hidden.length > 0 && (
          <div
            className="grid transition-all duration-700 ease-in-out"
            style={{
              gridTemplateRows: open ? "1fr" : "0fr",
              opacity: open ? 1 : 0,
            }}
          >
            <div className="overflow-hidden">
              <div className="space-y-8">
                {hidden.map((faq) => (
                  <FaqCard key={`faq-${faqs.indexOf(faq)}`} faq={faq} />
                ))}
              </div>
            </div>
          </div>
        )}
      </dl>

      {hidden.length > 0 && (
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => setOpen((v) => !v)}
            className="group relative flex items-center gap-2 overflow-hidden rounded-full border border-teal-500/20 bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-[#999] transition-all hover:border-teal-400/40 hover:text-white hover:shadow-[0_0_20px_rgba(20,184,166,0.15)]"
          >
            {!open && (
              <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_3s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-teal-400/15 to-transparent" />
            )}
            {open ? "Show less" : `Show ${hidden.length} more`}
            <IconChevronDown
              className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      )}
    </>
  );
}

function FaqCard({ faq }: { faq: FaqItem }) {
  return (
    <div className="rounded-xl border border-white/[0.06] px-6 py-5 transition-colors hover:border-white/[0.12]">
      <dt className="flex items-start gap-3">
        <IconQuestionMark className="mt-0.5 size-5 shrink-0 text-[#555]" />
        <span className="text-base font-semibold text-white">{faq.q}</span>
      </dt>
      <dd className="mt-3 pl-8 text-sm leading-relaxed text-[#888]">
        {faq.a}
      </dd>
    </div>
  );
}
