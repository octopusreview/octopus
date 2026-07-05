"use client";

import { useEffect, useRef, useState } from "react";

// Auto-playing, non-interactive terminal for the marketing hero. Types a
// scripted `octp login` -> `octp review --pr 42` -> findings sequence, then
// loops. Zero dependencies: React state + one CSS keyframe for the caret.
// Honors prefers-reduced-motion by rendering the full transcript statically.

type Tone = "cmd" | "out" | "dim" | "ok" | "warn" | "crit" | "info";
type Step = { kind: "cmd" | "out"; text: string; tone?: Tone };

const SCRIPT: Step[] = [
  { kind: "cmd", text: "octp login" },
  { kind: "out", text: "→ Opening browser to authenticate…", tone: "dim" },
  { kind: "out", text: "✓ Signed in as cem@acme.dev", tone: "ok" },
  { kind: "cmd", text: "octp review --pr 42" },
  { kind: "out", text: "→ Indexing repository · 128 files", tone: "dim" },
  { kind: "out", text: "→ Reviewing diff with whole-repo context…", tone: "dim" },
  { kind: "out", text: "⚠ 3 findings posted to PR #42", tone: "warn" },
  { kind: "out", text: "  ● auth.ts:88 — token compared with == (timing-unsafe)", tone: "crit" },
  { kind: "out", text: "  ● api/users.ts:23 — N+1 query inside request loop", tone: "warn" },
  { kind: "out", text: "  ● date.ts:5 — prefer Intl.DateTimeFormat over manual format", tone: "info" },
  { kind: "out", text: "✓ Review complete in 47s", tone: "ok" },
];

const TONE_CLASS: Record<Tone, string> = {
  cmd: "text-white",
  out: "text-[#c9c9c9]",
  dim: "text-[#6a6a6a]",
  ok: "text-[#10d8be]",
  warn: "text-[#f0a868]",
  crit: "text-[#ff6b6b]",
  info: "text-[#6ea8fe]",
};

type Line = { text: string; tone: Tone };

export function LandingTerminalHero({ className = "" }: { className?: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, active]);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setLines(
        SCRIPT.map((s) => ({ text: s.text, tone: s.kind === "cmd" ? "cmd" : s.tone ?? "out" })),
      );
      setActive(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const committed: Line[] = [];
    const after = (ms: number, fn: () => void) => {
      timer = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    };

    const runStep = (i: number) => {
      if (i >= SCRIPT.length) {
        after(2800, () => {
          committed.length = 0;
          setLines([]);
          setActive(null);
          runStep(0);
        });
        return;
      }
      const step = SCRIPT[i];
      if (step.kind === "cmd") {
        setActive("");
        let c = 0;
        const typeChar = () => {
          c += 1;
          setActive(step.text.slice(0, c));
          if (c < step.text.length) after(38, typeChar);
          else
            after(320, () => {
              committed.push({ text: step.text, tone: "cmd" });
              setLines([...committed]);
              setActive(null);
              after(280, () => runStep(i + 1));
            });
        };
        after(300, typeChar);
      } else {
        after(step.text.startsWith("  ●") ? 200 : 420, () => {
          committed.push({ text: step.text, tone: step.tone ?? "out" });
          setLines([...committed]);
          runStep(i + 1);
        });
      }
    };
    runStep(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl shadow-black/40 ${className}`}
    >
      <style>{`@media (prefers-reduced-motion: no-preference){@keyframes octpBlink{0%,49%{opacity:1}50%,100%{opacity:0}}}`}</style>
      {/* window chrome */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]/80" />
          <span className="size-3 rounded-full bg-[#febc2e]/80" />
          <span className="size-3 rounded-full bg-[#28c840]/80" />
        </div>
        <span className="font-mono text-[11px] text-[#666]">octp · ~/acme/api</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#10d8be]">
          <span className="size-1.5 rounded-full bg-[#10d8be]" />
          ready
        </span>
      </div>
      {/* body */}
      <div
        ref={scrollRef}
        className="h-[300px] overflow-hidden px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] sm:h-[340px] sm:text-[13px]"
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap ${TONE_CLASS[line.tone]}`}>
            {line.tone === "cmd" ? (
              <>
                <span className="text-[#10d8be]/80">$</span> {line.text}
              </>
            ) : (
              line.text
            )}
          </div>
        ))}
        {/* active prompt + caret */}
        <div className="whitespace-pre-wrap text-white">
          <span className="text-[#10d8be]/80">$</span> {active ?? ""}
          <span
            className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-[#10d8be]"
            style={{ animation: "octpBlink 1s step-end infinite" }}
          />
        </div>
      </div>
    </div>
  );
}
