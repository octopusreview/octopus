"use client";

import { useEffect, useRef, useState } from "react";
import { getPubbyClient } from "@/lib/pubby-client";

type Stats = {
  chunks: number;
  findings: number;
  reviews: number;
  repositories: number;
};

function useAnimatedNumber(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const start = prevTarget.current;
    prevTarget.current = target;
    if (target === 0) return;

    const startTime = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function formatNumber(n: number, raw?: boolean): string {
  if (raw) return n.toLocaleString("en-US");
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

const statsMeta = [
  { key: "chunks" as const, label: "Code Chunks", suffix: "+", raw: true },
  { key: "findings" as const, label: "Findings", suffix: "+", raw: false },
  { key: "reviews" as const, label: "PR Reviews", suffix: "+", raw: false },
  { key: "repositories" as const, label: "Repositories", suffix: "", raw: false },
];

export function LandingStats({ initial }: { initial: Stats }) {
  const [stats, setStats] = useState({ ...initial, chunks: 1_234_567 });
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Intersection observer to trigger count animation on scroll
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Pubby real-time updates
  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe("landing-stats");

    channel.bind("stats:updated", (data: unknown) => {
      const update = data as Partial<Stats>;
      setStats((prev) => ({ ...prev, ...update }));
    });

    return () => {
      channel.unbindAll();
      pubby.unsubscribe("landing-stats");
    };
  }, []);

  return (
    <div ref={sectionRef} className="mb-3 flex flex-col items-center gap-4 px-2 sm:flex-row sm:justify-between">
      <div className="flex items-center justify-center gap-6 sm:gap-8 sm:justify-start">
        {statsMeta.map((meta, i) => (
          <StatCard
            key={meta.key}
            value={isVisible ? stats[meta.key] : 0}
            label={meta.label}
            suffix={meta.suffix}
            raw={meta.raw}
            delay={i * 100}
          />
        ))}
      </div>
      {/* AI provider logos */}
      <div className="hidden items-center gap-2.5 sm:flex">
        <img src="/claude-color.svg" alt="Claude" className="h-3.5 w-3.5" />
        <img src="/claude-text.svg" alt="Claude" className="h-3 invert brightness-50" />
        <span className="text-white/15">+</span>
        <img src="/openai.svg" alt="OpenAI" className="h-3.5 w-3.5 invert brightness-50" />
        <img src="/openai-text.svg" alt="OpenAI" className="h-3 invert brightness-50" />
        <span className="text-white/15">+</span>
        <img src="/cohere-color.svg" alt="Cohere" className="h-3.5 w-3.5" />
        <img src="/cohere-text.svg" alt="Cohere" className="h-3 invert brightness-50" />
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  suffix,
  raw,
  delay,
}: {
  value: number;
  label: string;
  suffix: string;
  raw: boolean;
  delay: number;
}) {
  const animated = useAnimatedNumber(value);

  return (
    <div className="group/stat cursor-default" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-sm font-semibold tabular-nums text-white sm:text-xs">
        {formatNumber(animated, raw)}
        {suffix && <span className="text-[#555]">{suffix}</span>}
      </div>
      <div className="text-[11px] text-[#555] transition-colors duration-200 group-hover/stat:text-white sm:text-[9px]">{label}</div>
    </div>
  );
}
