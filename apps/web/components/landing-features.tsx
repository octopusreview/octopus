"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import {
  IconSearch,
  IconTerminal2,
  IconDatabase,
  IconBook,
  IconUsers,
  IconChartBar,
  IconCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";

function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          obs.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

export function LandingFeatures() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-14">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">Features</span>
        <h2 className="mt-4 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl md:text-5xl lg:text-[3.5rem]">
          Everything you need
          <br />
          to ship &amp; review.
        </h2>
        <p className="mt-5 max-w-lg text-[#666] sm:text-lg">
          From RAG-powered chat to CLI tooling — everything
          happens through a single platform.
        </p>
      </div>

      {/* Hero Feature */}
      <HeroCard
        title="RAG Chat"
        description="Ask questions about your codebase. Vector search + reranking delivers precise, context-aware answers grounded in your actual code."
        icon={<IconSearch className="size-5" />}
      >
        <PreviewRagChat />
      </HeroCard>

      {/* 3-Column Grid */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BentoCard
          title="CLI Tool"
          description="Review PRs, query code, and manage repos from your terminal."
          icon={<IconTerminal2 className="size-4" />}
        >
          <PreviewCli />
        </BentoCard>

        <BentoCard
          title="Codebase Indexing"
          description="Chunks, embeds, and indexes your entire codebase for instant retrieval."
          icon={<IconDatabase className="size-4" />}
        >
          <PreviewIndexing />
        </BentoCard>

        <BentoCard
          title="Knowledge Base"
          description="Feed your org's standards, docs, and conventions. Reviews get smarter over time."
          icon={<IconBook className="size-4" />}
        >
          <PreviewKnowledge />
        </BentoCard>
      </div>

      {/* Bottom Row: Wide + Narrow */}
      <div className="mt-4 grid gap-4 md:grid-cols-5">
        <BentoCard
          title="Team Sharing"
          description="Organization-level config, shared knowledge, and team-wide review standards."
          icon={<IconUsers className="size-4" />}
          className="md:col-span-3"
        >
          <PreviewTeam />
        </BentoCard>

        <BentoCard
          title="Analytics"
          description="Track review quality, token usage, cost per repo, and developer velocity."
          icon={<IconChartBar className="size-4" />}
          className="md:col-span-2"
        >
          <PreviewAnalytics />
        </BentoCard>
      </div>
    </div>
  );
}

function HeroCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = useInView();

  return (
    <div
      ref={ref}
      className="group grid overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.12] md:grid-cols-2"
    >
      {/* Text side */}
      <div className="flex flex-col justify-center p-8 md:p-10">
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-white/[0.06] text-[#888] transition-colors group-hover:bg-white/[0.1]">
          {icon}
        </div>
        <h3 className="text-2xl font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-[#666] md:text-base">{description}</p>
      </div>
      {/* Preview side */}
      <div className="p-4 md:p-6">{children}</div>
    </div>
  );
}

function BentoCard({
  title,
  description,
  icon,
  className = "",
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useInView();

  return (
    <div
      ref={ref}
      className={`group flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.12] ${className}`}
    >
      {/* Header */}
      <div className="p-6 pb-3">
        <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-white/[0.06] text-[#888] transition-colors group-hover:bg-white/[0.1]">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[#666]">{description}</p>
      </div>
      {/* Preview content */}
      <div className="flex-1 px-6 pb-6 pt-2">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview panels                                                      */
/* ------------------------------------------------------------------ */

function PreviewRagChat() {
  return (
    <div className="bento-stagger space-y-3 rounded-xl bg-[#111] p-4">
      {/* User message */}
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-xs text-[#ccc]">
        How does the auth middleware validate tokens?
      </div>
      {/* AI response */}
      <div className="flex items-start gap-2.5">
        <Image src="/logo.svg" alt="" width={20} height={20} className="mt-1 shrink-0" />
        <div className="space-y-2 rounded-2xl rounded-bl-md bg-white/[0.04] px-3.5 py-2.5 text-xs">
          <p className="text-[#ccc]">
            The middleware extracts the JWT from the{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-white">Authorization</code> header,
            validates it using{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-white">jose.jwtVerify()</code>,
            checks token expiry, and attaches the decoded user to context.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">auth.ts:12</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">jwt.ts:45</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">types.ts:8</span>
          </div>
        </div>
      </div>
      {/* Another user message */}
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-xs text-[#ccc]">
        What happens if the token is expired?
      </div>
      <div className="flex items-start gap-2.5">
        <Image src="/logo.svg" alt="" width={20} height={20} className="mt-1 shrink-0" />
        <div className="rounded-2xl rounded-bl-md bg-white/[0.04] px-3.5 py-2.5 text-xs text-[#999]">
          <span className="inline-flex gap-1"><span className="animate-pulse">...</span></span>
        </div>
      </div>
    </div>
  );
}

function PreviewCli() {
  return (
    <div className="bento-stagger space-y-2.5 rounded-xl bg-[#111] p-4 font-mono text-[11px] leading-relaxed">
      <div>
        <span className="text-[#555]">$</span>{" "}
        <span className="text-[#ccc]">octopus pr review 42</span>
      </div>
      <div className="text-[#666]">
        Fetching diff for PR #42...<br />
        Reviewing 3 changed files with 847 context chunks...
      </div>
      <div className="space-y-1 rounded-lg bg-white/[0.03] p-2.5">
        <div className="flex items-start gap-2">
          <IconAlertTriangle className="mt-0.5 size-3 shrink-0 text-[#fbbf24]" />
          <span className="text-[#999]"><span className="text-[#ccc]">auth.ts:12</span> — Consider rate limiting</span>
        </div>
        <div className="flex items-start gap-2">
          <IconCheck className="mt-0.5 size-3 shrink-0 text-[#4ade80]" />
          <span className="text-[#999]"><span className="text-[#ccc]">middleware.ts:8</span> — Good error handling</span>
        </div>
      </div>
      <div className="border-t border-white/[0.04] pt-2.5">
        <span className="text-[#555]">$</span>{" "}
        <span className="text-[#ccc]">octopus repo status</span>
      </div>
      <div className="text-[#666]">
        <span className="text-[#4ade80]">Indexed</span> · 4,832 chunks · Last review: 2m ago
      </div>
    </div>
  );
}

function PreviewIndexing() {
  return (
    <div className="bento-stagger space-y-2.5 rounded-xl bg-[#111] p-4 font-mono text-[11px] leading-relaxed">
      <div className="text-[#666]">
        Chunking 1,247 files <span className="text-[#555]">(1500 chars, 200 overlap)</span>
      </div>
      <div className="space-y-2 rounded-lg bg-white/[0.03] p-2.5">
        <div className="flex items-center justify-between text-[#888]">
          <span>Embedding progress</span>
          <span className="text-[#ccc]">78%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="bento-progress-fill h-full rounded-full bg-gradient-to-r from-[#4ade80]/60 to-[#4ade80]" />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 text-[10px]">
          <div className="rounded bg-white/[0.04] p-1.5 text-center">
            <div className="text-[#ccc]">4,832</div>
            <div className="text-[#555]">chunks</div>
          </div>
          <div className="rounded bg-white/[0.04] p-1.5 text-center">
            <div className="text-[#ccc]">3,072</div>
            <div className="text-[#555]">dims</div>
          </div>
          <div className="rounded bg-white/[0.04] p-1.5 text-center">
            <div className="text-[#ccc]">Qdrant</div>
            <div className="text-[#555]">storage</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewKnowledge() {
  return (
    <div className="bento-stagger space-y-2 rounded-xl bg-[#111] p-4">
      {[
        { title: "Error Handling Standards", type: "Convention" },
        { title: "API Response Format", type: "Standard" },
        { title: "Authentication Flow", type: "Architecture" },
      ].map((item) => (
        <div key={item.title} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] p-2.5">
          <IconBook className="size-3.5 shrink-0 text-[#888]" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-[#ccc]">{item.title}</div>
          </div>
          <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">{item.type}</span>
        </div>
      ))}
    </div>
  );
}

function PreviewTeam() {
  return (
    <div className="bento-stagger space-y-2 rounded-xl bg-[#111] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-white">Team Members</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">Acme Corp</span>
      </div>
      {[
        { name: "Sarah Chen", role: "Admin", repos: 8, avatar: "SC" },
        { name: "Alex Rivera", role: "Reviewer", repos: 5, avatar: "AR" },
        { name: "Jordan Kim", role: "Reviewer", repos: 3, avatar: "JK" },
        { name: "Morgan Lee", role: "Member", repos: 6, avatar: "ML" },
      ].map((m) => (
        <div key={m.name} className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] p-2.5">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[9px] font-medium text-[#ccc]">
            {m.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-[#ccc]">{m.name}</div>
            <div className="text-[10px] text-[#555]">{m.repos} repos</div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${m.role === "Admin" ? "bg-[#4ade80]/10 text-[#4ade80]" : "bg-white/[0.06] text-[#888]"}`}>
            {m.role}
          </span>
        </div>
      ))}
      <div className="mt-1 rounded-lg border border-dashed border-white/[0.08] p-2.5 text-center text-[11px] text-[#555]">
        Shared review config across 8 repositories
      </div>
    </div>
  );
}

function PreviewAnalytics() {
  const bars = [
    { label: "Mon", h: 50, reviews: 12, delay: 0 },
    { label: "Tue", h: 36, reviews: 8, delay: 80 },
    { label: "Wed", h: 65, reviews: 15, delay: 160 },
    { label: "Thu", h: 28, reviews: 6, delay: 240 },
    { label: "Fri", h: 55, reviews: 13, delay: 320 },
    { label: "Sat", h: 16, reviews: 3, delay: 400 },
    { label: "Sun", h: 12, reviews: 2, delay: 480 },
  ];

  return (
    <div className="space-y-3 rounded-xl bg-[#111] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white">Weekly Overview</span>
        <span className="text-[10px] text-[#555]">Mar 10 — Mar 16</span>
      </div>
      {/* Chart */}
      <div className="rounded-lg bg-white/[0.03] p-3">
        <div className="flex items-end gap-1.5">
          {bars.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[9px] text-[#888]">{b.reviews}</span>
              <div
                className="bento-bar w-full rounded-sm bg-gradient-to-t from-[#4ade80]/30 to-[#4ade80]/60"
                style={{ height: `${b.h}px`, animationDelay: `${b.delay}ms` }}
              />
              <span className="text-[9px] text-[#555]">{b.label}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Metrics */}
      <div className="bento-stagger grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/[0.03] p-2 text-center">
          <div className="text-sm font-bold text-white">59</div>
          <div className="text-[9px] text-[#555]">Reviews</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-2 text-center">
          <div className="text-sm font-bold text-white">1.8h</div>
          <div className="text-[9px] text-[#555]">Avg merge</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-2 text-center">
          <div className="text-sm font-bold text-[#4ade80]">$4.20</div>
          <div className="text-[9px] text-[#555]">Cost</div>
        </div>
      </div>
    </div>
  );
}
