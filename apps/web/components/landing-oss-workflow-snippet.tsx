"use client";

import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";

const yaml = `name: Octopus Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: octopusreview/action@v1`;

export function LandingOssWorkflowSnippet() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard not available
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-[#ff5f56]/70" />
          <span className="size-2.5 rounded-full bg-[#ffbd2e]/70" />
          <span className="size-2.5 rounded-full bg-[#27c93f]/70" />
        </div>
        <span className="text-[11px] text-[#666]">.github/workflows/octopus.yml</span>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy workflow"
          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0c0c0c]/80 px-2 py-1.5 text-[11px] text-[#888] backdrop-blur transition-colors hover:border-white/[0.15] hover:text-white"
        >
          {copied ? (
            <>
              <IconCheck className="size-3.5 text-[#10D8BE]" />
              <span className="text-[#10D8BE]">Copied</span>
            </>
          ) : (
            <>
              <IconCopy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
        <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-relaxed text-[#ddd]">
          <code>{yaml}</code>
        </pre>
      </div>
    </div>
  );
}
