"use client";

import { useState } from "react";

const dependents = [
  { file: "workers/refund.ts", note: "still calls charge() the old way", broken: true },
  { file: "api/invoices.ts", note: "call updated", broken: false },
  { file: "tests/charge.test.ts", note: "covers the new argument", broken: false },
];

const pill =
  "rounded-full px-5 py-2 text-sm font-medium transition-colors aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-black";

export function DiffSwitch() {
  const [whole, setWhole] = useState(false);

  return (
    <div className="mx-auto mt-10 max-w-3xl text-left">
      <div
        role="group"
        aria-label="What the reviewer reads"
        className="mx-auto flex w-fit rounded-full border border-white/[0.1] text-[#999]"
      >
        <button type="button" aria-pressed={!whole} onClick={() => setWhole(false)} className={pill}>
          Diff only
        </button>
        <button type="button" aria-pressed={whole} onClick={() => setWhole(true)} className={pill}>
          Whole codebase
        </button>
      </div>

      <div className="mt-6 grid items-center gap-4 rounded-2xl border border-white/[0.06] bg-[#161616] p-5 md:grid-cols-[1fr_auto_1fr] md:p-8">
        <div className="rounded-xl border border-primary/60 bg-primary/10 px-4 py-3">
          <p className="font-mono text-sm text-white">billing/charge.ts</p>
          <p className="mt-1 text-xs text-[#999]">changed: charge() gains an argument</p>
        </div>

        <span aria-hidden="true" className={`text-center text-xl ${whole ? "text-primary" : "text-[#444]"}`}>
          <span className="md:hidden">↓</span>
          <span className="hidden md:inline">→</span>
        </span>

        <ul className="space-y-3">
          {dependents.map((d) => (
            <li
              key={d.file}
              className={`rounded-xl border px-4 py-3 transition-all ${
                !whole && d.broken
                  ? "border-dashed border-white/[0.12] opacity-40"
                  : d.broken
                    ? "border-amber-400/70 bg-amber-400/10"
                    : "border-primary/60 bg-primary/10"
              }`}
            >
              <p className="font-mono text-sm text-white">{d.file}</p>
              <p className="mt-1 text-xs text-[#999]">{whole || !d.broken ? d.note : "not read"}</p>
            </li>
          ))}
        </ul>
      </div>

      <p aria-live="polite" className="mt-4 text-center text-sm text-[#999]">
        {whole ? (
          <>
            <span className="font-semibold text-white">Reads 4 files.</span> The review can point at{" "}
            <code className="text-[#ccc]">workers/refund.ts</code>, which still passes two arguments to{" "}
            <code className="text-[#ccc]">charge()</code>.
          </>
        ) : (
          <>
            <span className="font-semibold text-white">Reads 3 files.</span> The diff leaves out the refund
            worker, so the reviewer cannot check which arguments it passes to{" "}
            <code className="text-[#ccc]">charge()</code>.
          </>
        )}
      </p>
      <p className="mt-1 text-center text-xs text-[#555]">An illustration, not a real review.</p>
    </div>
  );
}
