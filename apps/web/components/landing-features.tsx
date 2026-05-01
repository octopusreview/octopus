"use client";

import { type ComponentType, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  IconBook,
  IconChartBar,
  IconChevronRight,
  IconDatabase,
  IconFileText,
  IconSearch,
  IconTerminal2,
  IconUsers,
} from "@tabler/icons-react";

type FeatureId = "chat" | "cli" | "index" | "knowledge" | "team" | "analytics";

type Feature = {
  id: FeatureId;
  title: string;
  description: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
};

const AUTO_ADVANCE_MS = 5600;
const INDEXED_FILES = ["packages/api/auth.ts", "apps/web/middleware.ts", "packages/db/schema.prisma"];

const features: Feature[] = [
  {
    id: "chat",
    title: "Ask your codebase",
    description: "RAG chat answers with source citations from your actual repo.",
    eyebrow: "RAG Chat",
    icon: IconSearch,
  },
  {
    id: "cli",
    title: "Review from terminal",
    description: "Run PR reviews, query context, and check repo state from the CLI.",
    eyebrow: "CLI Tool",
    icon: IconTerminal2,
  },
  {
    id: "index",
    title: "Keep context fresh",
    description: "Chunk, embed, and refresh your codebase for instant retrieval.",
    eyebrow: "Indexing",
    icon: IconDatabase,
  },
  {
    id: "knowledge",
    title: "Apply team standards",
    description: "Knowledge base docs guide every review without repeating yourself.",
    eyebrow: "Knowledge",
    icon: IconBook,
  },
  {
    id: "team",
    title: "Share one setup",
    description: "Org rules, repositories, and reviewer settings stay aligned.",
    eyebrow: "Team",
    icon: IconUsers,
  },
  {
    id: "analytics",
    title: "Track the loop",
    description: "See review volume, cost, and signal quality across repositories.",
    eyebrow: "Analytics",
    icon: IconChartBar,
  },
];

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

function getNextFeatureId(currentId: FeatureId) {
  const currentIndex = features.findIndex((feature) => feature.id === currentId);
  return features[(currentIndex + 1) % features.length].id;
}

function useTypewriter(text: string, speed = 24, delay = 300, enabled = true) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    setDisplayedText("");

    if (!enabled) return;

    let index = 0;
    let timeoutId: number;

    const typeNext = () => {
      index += 1;
      setDisplayedText(text.slice(0, index));

      if (index < text.length) {
        timeoutId = window.setTimeout(typeNext, speed);
      }
    };

    timeoutId = window.setTimeout(typeNext, delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, enabled, speed, text]);

  return displayedText;
}

export function LandingFeatures() {
  const ref = useInView();
  const [activeId, setActiveId] = useState<FeatureId>("chat");
  const activeFeature = features.find((feature) => feature.id === activeId) ?? features[0];
  const ActiveIcon = activeFeature.icon;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveId((currentId) => getNextFeatureId(currentId));
    }, AUTO_ADVANCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeId]);

  return (
    <div ref={ref} className="mx-auto max-w-5xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.65fr)] lg:items-end">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#10d8be]/75">Features</span>
          <h2 className="mt-4 text-3xl font-bold leading-[1.05] text-white sm:text-4xl md:text-5xl">
            Review with context,
            <br />
            not noise.
          </h2>
        </div>
        <p className="text-[#858585] sm:text-lg lg:pb-1">
          Pick a workflow and see how Octopus keeps chat, reviews, standards, and repo context in one calm loop.
        </p>
      </div>

      <div className="mt-12 overflow-hidden rounded-lg border border-white/[0.08] bg-[#101010] shadow-2xl shadow-black/25">
        <div className="grid lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="border-b border-white/[0.08] bg-white/[0.025] p-3 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center justify-between px-2 py-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#666]">Workspace</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Everything connected</h3>
              </div>
              <span className="rounded-full border border-[#10d8be]/20 bg-[#10d8be]/10 px-2.5 py-1 text-[11px] text-[#10d8be]">
                Live
              </span>
            </div>

            <div className="space-y-1">
              {features.map((feature) => {
                const Icon = feature.icon;
                const isActive = feature.id === activeId;

                return (
                  <button
                    key={feature.id}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveId(feature.id)}
                    className={`group relative grid w-full grid-cols-[40px_1fr_18px] items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition-colors ${
                      isActive
                        ? "border-[#10d8be]/35 bg-[#10d8be]/10"
                        : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.045]"
                    }`}
                  >
                    <span
                      className={`flex size-10 items-center justify-center rounded-lg transition-colors ${
                        isActive ? "bg-[#10d8be] text-[#061210]" : "bg-white/[0.06] text-[#8d8d8d] group-hover:text-white"
                      }`}
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{feature.title}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-[#808080]">
                        {feature.description}
                      </span>
                    </span>
                    <IconChevronRight
                      className={`size-4 transition-colors ${isActive ? "text-[#10d8be]" : "text-[#444] group-hover:text-[#888]"}`}
                    />
                    {isActive && (
                      <span
                        key={activeId}
                        className="feature-cycle-progress absolute bottom-0 left-0 h-px bg-[#10d8be]"
                        style={{ animationDuration: `${AUTO_ADVANCE_MS}ms` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-[560px] overflow-hidden bg-[#0b0b0b] p-5 sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(16,216,190,0.14),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.045),transparent)]" />

            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-lg bg-[#10d8be]/12 text-[#10d8be]">
                  <ActiveIcon className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#666]">{activeFeature.eyebrow}</p>
                  <h3 className="mt-1 text-2xl font-semibold text-white">{activeFeature.title}</h3>
                </div>
              </div>
              <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-xs text-[#8d8d8d] sm:block">
                {activeFeature.description}
              </span>
            </div>

            <div key={activeId} className="feature-panel-enter relative mt-8">
              <FeaturePreview featureId={activeId} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <FeatureMetric value="Source-backed" label="answers point to real code" />
        <FeatureMetric value="Every PR" label="reviews start automatically" />
        <FeatureMetric value="Rules synced" label="team standards stay aligned" />
      </div>
    </div>
  );
}

function FeaturePreview({ featureId }: { featureId: FeatureId }) {
  switch (featureId) {
    case "chat":
      return <ChatPreview />;
    case "cli":
      return <CliPreview />;
    case "index":
      return <IndexPreview />;
    case "knowledge":
      return <KnowledgePreview />;
    case "team":
      return <TeamPreview />;
    case "analytics":
      return <AnalyticsPreview />;
  }
}

function ChatPreview() {
  const question = "How does the auth middleware validate tokens?";
  const answer =
    "It extracts the JWT from the Authorization header, verifies it with jose.jwtVerify(), then attaches the decoded user to request context.";
  const typedQuestion = useTypewriter(question, 20, 250);
  const questionDone = typedQuestion.length === question.length;
  const typedAnswer = useTypewriter(answer, 18, 260, questionDone);
  const answerDone = typedAnswer.length === answer.length;

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-[#111] p-4 shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2 text-sm text-[#a8a8a8]">
          <span className="feature-pulse-dot size-2 rounded-full bg-[#10d8be]" />
          auth-service
        </div>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#858585]">3 sources</span>
      </div>

      <div className="mt-5 space-y-4">
        <div className="ml-auto min-h-11 max-w-[82%] rounded-lg bg-white/[0.08] px-4 py-3 text-sm text-[#dfdfdf]">
          {typedQuestion}
          {!questionDone && <TypingCursor />}
        </div>
        {questionDone && (
          <div className="feature-fade-in flex items-start gap-3">
            <Image src="/logo.svg" alt="" width={24} height={24} className="mt-1 shrink-0" />
            <div className="min-h-36 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.045] p-4 text-sm leading-relaxed text-[#d0d0d0]">
              {typedAnswer}
              {!answerDone && <TypingCursor />}
              {answerDone && (
                <div className="feature-fade-in mt-4 flex flex-wrap gap-2">
                  <Citation active>auth.ts:12</Citation>
                  <Citation>jwt.ts:45</Citation>
                  <Citation>types.ts:8</Citation>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CliPreview() {
  const command = "octopus pr review 42";
  const output = "Fetching diff for PR #42...\nRetrieving 847 context chunks...\nPosting inline findings to GitHub...";
  const typedCommand = useTypewriter(command, 45, 250);
  const typedOutput = useTypewriter(output, 28, 1300);
  const commandDone = typedCommand.length === command.length;
  const outputDone = typedOutput.length === output.length;

  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-white/[0.08] bg-[#080808] font-mono shadow-2xl shadow-black/30">
      <div className="flex gap-1 border-b border-white/[0.06] px-4 py-3">
        <span className="size-2 rounded-full bg-[#ff6b5f]/70" />
        <span className="size-2 rounded-full bg-[#f9c74f]/70" />
        <span className="size-2 rounded-full bg-[#10d8be]/70" />
      </div>
      <div className="feature-stagger space-y-4 p-5 text-sm">
        <p>
          <span className="text-[#555]">$</span>{" "}
          <span className="text-[#e7e7e7]">
            {typedCommand}
            {!commandDone && <TypingCursor />}
          </span>
        </p>
        <div className="min-h-[66px] whitespace-pre-line text-[#777]">
          {typedOutput}
          {commandDone && !outputDone && <TypingCursor />}
        </div>
        {outputDone && (
          <div className="feature-fade-in space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-3">
            <TerminalFinding tone="warn" file="auth.ts:12" text="Consider rate limiting token validation" />
            <TerminalFinding tone="ok" file="middleware.ts:8" text="Error handling matches project pattern" />
          </div>
        )}
      </div>
    </div>
  );
}

function IndexPreview() {
  const [visibleFileCount, setVisibleFileCount] = useState(0);

  useEffect(() => {
    setVisibleFileCount(0);

    const timeoutIds = INDEXED_FILES.map((_, index) =>
      window.setTimeout(() => {
        setVisibleFileCount(index + 1);
      }, 1350 + index * 320),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-[#111] p-5 shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#666]">Indexer</p>
          <h4 className="mt-1 text-xl font-semibold text-white">Repository context refresh</h4>
        </div>
        <span className="rounded-full bg-[#10d8be]/10 px-3 py-1 text-xs text-[#10d8be]">78%</span>
      </div>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="bento-progress-fill h-full rounded-full bg-[#10d8be]" />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <TypingPreviewMetric value="4,832" label="chunks" delay={250} />
        <TypingPreviewMetric value="3,072" label="dims" delay={520} />
        <TypingPreviewMetric value="1,247" label="files" delay={790} />
      </div>
      <div className="mt-6 min-h-[128px] space-y-2">
        {INDEXED_FILES.slice(0, visibleFileCount).map((file) => (
          <div key={file} className="feature-fade-in flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
            <span className="text-[#bdbdbd]">{file}</span>
            <span className="text-[#666]">indexed</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgePreview() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-[#111] p-5 shadow-2xl shadow-black/30">
      <div className="feature-stagger grid gap-3">
        {[
          ["Error Handling Standards", "Convention"],
          ["API Response Format", "Standard"],
          ["Authentication Flow", "Architecture"],
          ["Rate Limit Policy", "Security"],
        ].map(([title, label]) => (
          <div key={title} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.04] p-4">
            <IconFileText className="size-5 shrink-0 text-[#10d8be]" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{title}</p>
              <p className="mt-1 text-sm text-[#777]">Used automatically during reviews</p>
            </div>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#8a8a8a]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamPreview() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-[#111] p-5 shadow-2xl shadow-black/30">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-semibold text-white">Acme Engineering</p>
        <span className="rounded-full bg-[#10d8be]/10 px-3 py-1 text-xs text-[#10d8be]">8 repositories</span>
      </div>
      <div className="feature-stagger space-y-3">
        {[
          ["SC", "Sarah Chen", "Admin"],
          ["AR", "Alex Rivera", "Reviewer"],
          ["IK", "Ilya Kolasinac", "Reviewer"],
          ["ML", "Morgan Lee", "Member"],
        ].map(([avatar, name, role]) => (
          <div key={name} className="flex items-center gap-3 rounded-lg bg-white/[0.04] p-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-white/[0.08] text-xs font-medium text-[#d0d0d0]">
              {avatar}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-white">{name}</span>
              <span className="text-sm text-[#777]">Shared review config</span>
            </span>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs text-[#8a8a8a]">{role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsPreview() {
  const bars = [
    { label: "Mon", reviews: 12, height: 46 },
    { label: "Tue", reviews: 8, height: 32 },
    { label: "Wed", reviews: 15, height: 64 },
    { label: "Thu", reviews: 6, height: 38 },
    { label: "Fri", reviews: 13, height: 58 },
    { label: "Sat", reviews: 3, height: 18 },
    { label: "Sun", reviews: 2, height: 14 },
  ] as const;

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-white/[0.08] bg-[#111] p-5 shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-white">Weekly review signal</p>
        <span className="text-sm text-[#777]">Mar 10 - Mar 16</span>
      </div>
      <div className="mt-6 rounded-lg border border-white/[0.06] bg-white/[0.04] p-4">
        <div className="flex h-44 items-end gap-3">
          {bars.map((bar, index) => (
            <div key={bar.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="text-xs font-medium text-[#bdbdbd]">{bar.reviews}</span>
              <div
                className="feature-bar w-full rounded-t bg-gradient-to-t from-[#10d8be]/45 to-[#10d8be]"
                style={{ height: `${bar.height}%`, animationDelay: `${index * 80}ms` }}
              />
              <span className="text-xs text-[#777]">{bar.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <PreviewMetric value="59" label="reviews" />
        <PreviewMetric value="1.8h" label="avg merge" />
        <PreviewMetric value="$4.20" label="cost" accent />
      </div>
    </div>
  );
}

function Citation({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs ${active ? "bg-[#10d8be]/10 text-[#10d8be]" : "bg-white/[0.06] text-[#8a8a8a]"}`}>
      {children}
    </span>
  );
}

function TypingCursor() {
  return <span className="typing-cursor ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[#10d8be]" />;
}

function TerminalFinding({ file, text, tone }: { file: string; text: string; tone: "warn" | "ok" }) {
  return (
    <div className="flex items-start gap-2 text-xs leading-relaxed">
      <span className={tone === "warn" ? "text-[#f9c74f]" : "text-[#10d8be]"}>{tone === "warn" ? "!" : "✓"}</span>
      <span className="text-[#999]">
        <span className="text-[#e7e7e7]">{file}</span> - {text}
      </span>
    </div>
  );
}

function PreviewMetric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.045] p-4 text-center">
      <div className={`text-xl font-semibold ${accent ? "text-[#10d8be]" : "text-white"}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#666]">{label}</div>
    </div>
  );
}

function TypingPreviewMetric({ value, label, delay }: { value: string; label: string; delay: number }) {
  const typedValue = useTypewriter(value, 70, delay);
  const done = typedValue.length === value.length;

  return (
    <div className="rounded-lg bg-white/[0.045] p-4 text-center">
      <div className="min-h-7 text-xl font-semibold text-white">
        {typedValue}
        {!done && <TypingCursor />}
      </div>
      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#666]">{label}</div>
    </div>
  );
}

function FeatureMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-4 py-4 transition-colors hover:border-[#10d8be]/25 hover:bg-[#10d8be]/[0.055]">
      <div className="text-base font-semibold text-white sm:text-lg">{value}</div>
      <div className="text-sm text-[#7d7d7d]">{label}</div>
    </div>
  );
}
