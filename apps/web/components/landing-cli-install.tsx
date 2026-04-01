"use client";

import { useState } from "react";
import { IconCopy, IconCheck, IconTerminal2 } from "@tabler/icons-react";

type Platform = "mac-linux" | "windows";
type Method = "one-liner" | "npm";

const installCommands: Record<Platform, Record<Method, { comment: string; command: string }>> = {
  "mac-linux": {
    "one-liner": {
      comment: "# Works on macOS & Linux. Installs everything.",
      command: "curl -fsSL https://octopus-review.ai/install.sh | bash",
    },
    npm: {
      comment: "# Requires Node.js 18+",
      command: "npm install -g @octp/cli",
    },
  },
  windows: {
    "one-liner": {
      comment: "# Works on Windows. Run in PowerShell as Administrator.",
      command: "irm https://octopus-review.ai/install.ps1 | iex",
    },
    npm: {
      comment: "# Requires Node.js 18+",
      command: "npm install -g @octp/cli",
    },
  },
};

const platformLabels: Record<Platform, string> = {
  "mac-linux": "macOS/Linux",
  windows: "Windows",
};

const methodLabels: Record<Method, string> = {
  "one-liner": "One-liner",
  npm: "npm",
};

export function CliInstallSection() {
  const [platform, setPlatform] = useState<Platform>("mac-linux");
  const [method, setMethod] = useState<Method>("one-liner");
  const [copied, setCopied] = useState(false);

  const current = installCommands[platform][method];

  function handleCopy() {
    navigator.clipboard.writeText(current.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section id="cli" className="relative z-10 scroll-mt-20 px-4 py-8 sm:px-8 md:px-12">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
        <div className="mx-auto max-w-3xl">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
              Quick Start
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Install the CLI
            </h2>
            <p className="mt-4 text-[#888]">
              Review PRs, chat with your codebase, and run AI agents — all from your terminal.
            </p>
          </div>

          {/* Terminal card */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0c]">
            {/* Top bar: platform tabs + method tabs */}
            <div className="flex flex-col gap-0 border-b border-white/[0.06] sm:flex-row sm:items-center sm:justify-between">
              {/* Platform tabs */}
              <div className="flex items-center gap-0 border-b border-white/[0.06] sm:border-b-0">
                {/* Traffic lights */}
                <div className="flex items-center gap-1.5 px-4">
                  <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                  <span className="size-2.5 rounded-full bg-[#febc2e]" />
                  <span className="size-2.5 rounded-full bg-[#28c840]" />
                </div>
                {(["mac-linux", "windows"] as Platform[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPlatform(p)}
                    className={`px-4 py-3 text-xs font-medium transition-colors ${
                      platform === p
                        ? "bg-white/[0.06] text-white"
                        : "text-[#555] hover:text-[#888]"
                    }`}
                  >
                    {platformLabels[p]}
                  </button>
                ))}
              </div>

              {/* Method tabs */}
              <div className="flex items-center gap-0">
                {(["one-liner", "npm"] as Method[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`px-4 py-3 text-xs font-medium transition-colors ${
                      method === m
                        ? "text-white"
                        : "text-[#555] hover:text-[#888]"
                    }`}
                  >
                    <span
                      className={`rounded-full px-3 py-1 ${
                        method === m
                          ? "bg-[#10D8BE]/20 text-[#10D8BE]"
                          : ""
                      }`}
                    >
                      {methodLabels[m]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Code area */}
            <div className="relative px-6 py-6">
              <p className="font-mono text-sm text-[#555]">{current.comment}</p>
              <div className="mt-3 flex items-start gap-3">
                <span className="select-none font-mono text-sm text-[#10D8BE]">$</span>
                <code className="flex-1 break-all font-mono text-sm text-[#e0e0e0]">
                  {current.command}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 rounded-lg border border-white/[0.08] p-2 text-[#555] transition-colors hover:border-white/[0.15] hover:text-white"
                  aria-label="Copy command"
                >
                  {copied ? (
                    <IconCheck className="size-4 text-[#10D8BE]" />
                  ) : (
                    <IconCopy className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Bottom note */}
          <p className="mt-6 text-center text-sm text-[#555]">
            Works on macOS, Windows & Linux.{" "}
            {method === "one-liner"
              ? "The one-liner installs Node.js and everything else for you."
              : "Requires Node.js 18+ installed."}
          </p>

          {/* Docs link */}
          <div className="mt-6 flex justify-center">
            <a
              href="/docs/cli"
              className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
            >
              <IconTerminal2 className="size-4" />
              View full CLI documentation
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
