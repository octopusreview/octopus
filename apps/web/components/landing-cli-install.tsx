"use client";

import { useEffect, useRef, useState } from "react";
import { IconCopy, IconCheck, IconTerminal2 } from "@tabler/icons-react";
import { TrackedLink } from "@/components/tracked-link";

type Platform = "mac-linux" | "windows";

const DEFAULT_BASE_URL = "https://octopus-review.ai";

// Reduce any URL to a clean scheme://host[:port] origin — no path, query, or
// shell metacharacters — so it is safe to interpolate into the displayed
// curl/irm install command. Rejects non-http(s) or unparseable values; callers
// fall back to DEFAULT_BASE_URL. (window.location.origin is already clean, but
// NEXT_PUBLIC_APP_URL is operator-supplied, so validate both.)
function safeBaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

// Base URL for SSR / first paint: the configured app URL, else the canonical
// hosted domain. Replaced with the (validated) window origin after mount so
// self-hosted / reverse-proxied / custom-domain deployments show the right host.
const STATIC_BASE_URL = safeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ?? DEFAULT_BASE_URL;

function buildInstallCommands(
  baseUrl: string,
): Record<Platform, { comment: string; command: string }> {
  return {
    "mac-linux": {
      comment: "# Works on macOS & Linux. Installs everything — no Node.js needed.",
      command: `curl -fsSL ${baseUrl}/install.sh | bash`,
    },
    windows: {
      comment: "# Works on Windows (PowerShell). Installs everything for you.",
      command: `powershell -c "irm ${baseUrl}/install.ps1 | iex"`,
    },
  };
}

const platformLabels: Record<Platform, string> = {
  "mac-linux": "macOS/Linux",
  windows: "Windows",
};

function detectPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac") || ua.includes("linux") || ua.includes("x11") || ua.includes("unix")) return "mac-linux";
  return null;
}

export function CliInstallSection({ embedded = false }: { embedded?: boolean } = {}) {
  const [platform, setPlatform] = useState<Platform>("mac-linux");
  const [copied, setCopied] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(STATIC_BASE_URL);
  const didDetect = useRef(false);

  useEffect(() => {
    if (didDetect.current) return;
    didDetect.current = true;

    const detected = detectPlatform();
    if (detected) setPlatform(detected);

    const origin = safeBaseUrl(window.location?.origin);
    if (origin) setBaseUrl(origin);
  }, []);

  const installCommands = buildInstallCommands(baseUrl);
  const current = installCommands[platform];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(current.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the command text so user can copy manually
    }
  }

  const content = (
    <>
      <div className="mx-auto max-w-3xl">
        {!embedded && (
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
        )}

        {embedded && (
          <div className="mb-6 text-center">
            <h3 className="text-lg font-semibold text-white">Install the CLI</h3>
            <p className="mt-1 text-sm text-[#888]">
              Review PRs, chat with your codebase, and run AI agents from your terminal.
            </p>
          </div>
        )}

        {/* Terminal card */}
        <div className={`${embedded ? "" : "mt-12 "}overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0c0c]`}>
          {/* Top bar: platform tabs */}
          <div className="flex items-center gap-0 border-b border-white/[0.06]">
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
        <p className="mt-4 text-center text-xs text-[#555]">
          Works on macOS, Windows &amp; Linux. The installer sets up everything for you.
        </p>

        {/* Docs link */}
        <div className="mt-4 flex justify-center">
          <TrackedLink
            href="/docs/cli"
            event="cta_click"
            eventParams={{ location: "cli_install_section", label: "cli_docs" }}
            className="inline-flex items-center gap-2 text-sm text-[#666] transition-colors hover:text-white"
          >
            <IconTerminal2 className="size-4" />
            View full CLI documentation
          </TrackedLink>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <section id="cli" className="relative z-10 scroll-mt-20 px-4 py-8 sm:px-8 md:px-12">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/[0.06] bg-[#161616] px-6 py-20 md:px-12 md:py-28">
        {content}
      </div>
    </section>
  );
}
