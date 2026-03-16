"use client";

import { useState } from "react";
import Image from "next/image";
import {
  IconSearch,
  IconTerminal2,
  IconDatabase,
  IconBook,
  IconUsers,
  IconChartBar,
  IconMessageChatbot,
  IconCheck,
  IconAlertTriangle,
  IconGitPullRequest,
} from "@tabler/icons-react";

const features = [
  {
    id: "rag-chat",
    icon: <IconSearch className="size-4" />,
    title: "RAG Chat",
    description: "Ask questions about your codebase. Vector search + reranking for precise answers.",
  },
  {
    id: "cli-tool",
    icon: <IconTerminal2 className="size-4" />,
    title: "CLI Tool",
    description: "Review PRs, query code, and manage repos from your terminal with @octp/cli.",
  },
  {
    id: "indexing",
    icon: <IconDatabase className="size-4" />,
    title: "Codebase Indexing",
    description: "Chunks, embeds, and indexes your entire codebase into Qdrant for instant retrieval.",
  },
  {
    id: "knowledge",
    icon: <IconBook className="size-4" />,
    title: "Knowledge Base",
    description: "Feed your org's standards, docs, and conventions. Reviews get smarter over time.",
  },
  {
    id: "team",
    icon: <IconUsers className="size-4" />,
    title: "Team Sharing",
    description: "Organization-level config, shared knowledge, and team-wide review standards.",
  },
  {
    id: "analytics",
    icon: <IconChartBar className="size-4" />,
    title: "Analytics",
    description: "Track review quality, token usage, cost per repo, and developer velocity.",
  },
];

export function LandingFeatures() {
  const [active, setActive] = useState("rag-chat");

  return (
    <div className="mx-auto max-w-5xl">
      {/* Full-width headline */}
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

      {/* Mobile: horizontal scroll tabs + preview below. Desktop: split layout */}

      {/* Mobile feature tabs (horizontal scroll) */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2 lg:hidden">
        {features.map((f) => (
          <button
            key={f.id}
            onClick={() => setActive(f.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition-all ${
              active === f.id
                ? "border-white/[0.15] bg-white/[0.08] text-white"
                : "border-white/[0.06] text-[#888]"
            }`}
          >
            <div className={`flex size-5 items-center justify-center ${active === f.id ? "text-white" : "text-[#666]"}`}>
              {f.icon}
            </div>
            {f.title}
          </button>
        ))}
      </div>

      {/* Mobile preview */}
      <div className="lg:hidden">
        <FeaturePreview activeId={active} />
      </div>

      {/* Desktop split layout */}
      <div className="hidden items-start gap-14 lg:grid lg:grid-cols-[1fr_1.1fr]">
        {/* Left side — Feature cards */}
        <div className="grid gap-2 sm:grid-cols-2">
          {features.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`group rounded-xl border p-4 text-left transition-all ${
                active === f.id
                  ? "border-white/[0.15] bg-white/[0.06]"
                  : "border-white/[0.06] hover:border-white/[0.1] hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  active === f.id
                    ? "bg-white text-[#0c0c0c]"
                    : "bg-white/[0.04] text-[#888] group-hover:bg-white/[0.08]"
                }`}>
                  {f.icon}
                </div>
                <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#666]">{f.description}</p>
            </button>
          ))}
        </div>

        {/* Right side — Dynamic preview */}
        <div className="sticky top-24">
          <FeaturePreview activeId={active} />
        </div>
      </div>
    </div>
  );
}

function FeaturePreview({ activeId }: { activeId: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#111] shadow-2xl shadow-black/30">
      {/* Browser/terminal chrome */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="flex gap-1.5">
          <div className="size-2.5 rounded-full bg-[#ff5f57]/80" />
          <div className="size-2.5 rounded-full bg-[#febc2e]/80" />
          <div className="size-2.5 rounded-full bg-[#28c840]/80" />
        </div>
        <span className="ml-3 text-xs text-[#555]">
          {activeId === "rag-chat" && "octopus — chat"}
          {activeId === "cli-tool" && "terminal — @octp/cli"}
          {activeId === "indexing" && "terminal — indexer"}
          {activeId === "knowledge" && "octopus — knowledge base"}
          {activeId === "team" && "octopus — team settings"}
          {activeId === "analytics" && "octopus — analytics"}
        </span>
      </div>

      <div className="p-5">
        {activeId === "rag-chat" && <PreviewRagChat />}
        {activeId === "cli-tool" && <PreviewCli />}
        {activeId === "indexing" && <PreviewIndexing />}
        {activeId === "knowledge" && <PreviewKnowledge />}
        {activeId === "team" && <PreviewTeam />}
        {activeId === "analytics" && <PreviewAnalytics />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview panels                                                      */
/* ------------------------------------------------------------------ */

function PreviewRagChat() {
  return (
    <div className="space-y-4">
      {/* User message */}
      <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-white/[0.08] px-4 py-2.5 text-sm text-[#ccc]">
        How does the auth middleware validate tokens?
      </div>
      {/* AI response */}
      <div className="flex items-start gap-3">
        <Image src="/logo.svg" alt="" width={24} height={24} className="mt-1 shrink-0" />
        <div className="space-y-2 rounded-2xl rounded-bl-md bg-white/[0.04] px-4 py-3 text-sm">
          <p className="text-[#ccc]">
            The middleware extracts the JWT from the <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-white">Authorization</code> header,
            validates it using <code className="rounded bg-white/[0.06] px-1 py-0.5 text-xs text-white">jose.jwtVerify()</code> with
            the public key from JWKS, checks token expiry, and attaches the decoded user to the request context.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">auth.ts:12</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">jwt.ts:45</span>
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">types.ts:8</span>
          </div>
        </div>
      </div>
      {/* Another user message */}
      <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-white/[0.08] px-4 py-2.5 text-sm text-[#ccc]">
        What happens if the token is expired?
      </div>
      <div className="flex items-start gap-3">
        <Image src="/logo.svg" alt="" width={24} height={24} className="mt-1 shrink-0" />
        <div className="rounded-2xl rounded-bl-md bg-white/[0.04] px-4 py-3 text-sm text-[#999]">
          <span className="inline-flex gap-1"><span className="animate-pulse">...</span></span>
        </div>
      </div>
    </div>
  );
}

function PreviewCli() {
  return (
    <div className="space-y-3 font-mono text-xs leading-relaxed">
      <div>
        <span className="text-[#555]">$</span>{" "}
        <span className="text-[#ccc]">octp review --pr 142</span>
      </div>
      <div className="text-[#666]">
        Fetching diff for PR #142...<br />
        Analyzing 3 changed files with context from 847 chunks...
      </div>
      <div className="space-y-1.5 rounded-lg bg-white/[0.03] p-3">
        <div className="flex items-start gap-2">
          <IconCheck className="mt-0.5 size-3 shrink-0 text-[#4ade80]" />
          <span className="text-[#999]"><span className="text-[#ccc]">auth.ts:14</span> — Proper 401 status code</span>
        </div>
        <div className="flex items-start gap-2">
          <IconAlertTriangle className="mt-0.5 size-3 shrink-0 text-[#fbbf24]" />
          <span className="text-[#999]"><span className="text-[#ccc]">auth.ts:12</span> — Consider rate limiting</span>
        </div>
        <div className="flex items-start gap-2">
          <IconCheck className="mt-0.5 size-3 shrink-0 text-[#4ade80]" />
          <span className="text-[#999]"><span className="text-[#ccc]">middleware.ts:8</span> — Good error handling</span>
        </div>
      </div>
      <div className="border-t border-white/[0.04] pt-3">
        <span className="text-[#555]">$</span>{" "}
        <span className="text-[#ccc]">octp status</span>
      </div>
      <div className="text-[#666]">
        <span className="text-[#4ade80]">3 repos indexed</span> · 12,847 chunks · Last review: 2m ago
      </div>
    </div>
  );
}

function PreviewIndexing() {
  return (
    <div className="space-y-3 font-mono text-xs leading-relaxed">
      <div>
        <span className="text-[#555]">$</span>{" "}
        <span className="text-[#ccc]">octp index --repo frontend</span>
      </div>
      <div className="space-y-1 text-[#666]">
        <div>Cloning repository...</div>
        <div>Detecting language: <span className="text-[#ccc]">TypeScript</span></div>
        <div>Chunking 1,247 files <span className="text-[#555]">(1500 chars, 200 overlap)</span></div>
      </div>
      <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
        <div className="flex items-center justify-between text-[#888]">
          <span>Embedding progress</span>
          <span className="text-[#ccc]">78%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-[#4ade80]/60 to-[#4ade80]" />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1 text-[10px]">
          <div className="rounded bg-white/[0.04] p-2 text-center">
            <div className="text-[#ccc]">4,832</div>
            <div className="text-[#555]">chunks</div>
          </div>
          <div className="rounded bg-white/[0.04] p-2 text-center">
            <div className="text-[#ccc]">3,072</div>
            <div className="text-[#555]">dimensions</div>
          </div>
          <div className="rounded bg-white/[0.04] p-2 text-center">
            <div className="text-[#ccc]">Qdrant</div>
            <div className="text-[#555]">storage</div>
          </div>
        </div>
      </div>
      <div className="text-[#4ade80]">
        Indexed 4,832 chunks into Qdrant collection &quot;frontend&quot;
      </div>
    </div>
  );
}

function PreviewKnowledge() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Knowledge Items</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">12 items</span>
      </div>
      <div className="space-y-2">
        {[
          { title: "Error Handling Standards", type: "Convention", chunks: 24 },
          { title: "API Response Format", type: "Standard", chunks: 18 },
          { title: "Authentication Flow", type: "Architecture", chunks: 42 },
          { title: "Testing Guidelines", type: "Convention", chunks: 31 },
          { title: "Database Naming Rules", type: "Standard", chunks: 15 },
        ].map((item) => (
          <div key={item.title} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3">
            <IconBook className="size-4 shrink-0 text-[#888]" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[#ccc]">{item.title}</div>
              <div className="mt-0.5 text-[10px] text-[#555]">{item.chunks} chunks indexed</div>
            </div>
            <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">{item.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTeam() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Team Members</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#888]">Acme Corp</span>
      </div>
      <div className="space-y-2">
        {[
          { name: "Sarah Chen", role: "Admin", repos: 8, avatar: "SC" },
          { name: "Alex Rivera", role: "Reviewer", repos: 5, avatar: "AR" },
          { name: "Jordan Kim", role: "Reviewer", repos: 3, avatar: "JK" },
          { name: "Morgan Lee", role: "Member", repos: 6, avatar: "ML" },
        ].map((m) => (
          <div key={m.name} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-medium text-[#ccc]">
              {m.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[#ccc]">{m.name}</div>
              <div className="mt-0.5 text-[10px] text-[#555]">{m.repos} repos</div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${m.role === "Admin" ? "bg-[#4ade80]/10 text-[#4ade80]" : "bg-white/[0.06] text-[#888]"}`}>
              {m.role}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-dashed border-white/[0.08] p-3 text-center text-xs text-[#555]">
        Shared review config across 8 repositories
      </div>
    </div>
  );
}

function PreviewAnalytics() {
  const bars = [
    { label: "Mon", h: 65, reviews: 12 },
    { label: "Tue", h: 48, reviews: 8 },
    { label: "Wed", h: 82, reviews: 15 },
    { label: "Thu", h: 35, reviews: 6 },
    { label: "Fri", h: 70, reviews: 13 },
    { label: "Sat", h: 20, reviews: 3 },
    { label: "Sun", h: 15, reviews: 2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">Weekly Overview</span>
        <span className="text-xs text-[#555]">Mar 10 — Mar 16</span>
      </div>

      {/* Chart */}
      <div className="rounded-lg bg-white/[0.03] p-4">
        <div className="mb-1 text-[10px] text-[#555]">Reviews per day</div>
        <div className="flex items-end gap-2">
          {bars.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-[#888]">{b.reviews}</span>
              <div
                className="w-full rounded-sm bg-gradient-to-t from-[#4ade80]/30 to-[#4ade80]/60"
                style={{ height: `${b.h}px` }}
              />
              <span className="text-[10px] text-[#555]">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-white/[0.03] p-3 text-center">
          <div className="text-lg font-bold text-white">59</div>
          <div className="text-[10px] text-[#555]">Total reviews</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-3 text-center">
          <div className="text-lg font-bold text-white">1.8h</div>
          <div className="text-[10px] text-[#555]">Avg. time to merge</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-3 text-center">
          <div className="text-lg font-bold text-[#4ade80]">$4.20</div>
          <div className="text-[10px] text-[#555]">Cost this week</div>
        </div>
      </div>
    </div>
  );
}
