"use client";

import { useState, useCallback } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";

export function CodeBlock({
  children,
  title,
}: {
  children: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="group relative mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
      {title && (
        <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-xs text-[#666]">
          {title}
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto bg-[#161616] px-4 py-3">
          <code className="text-sm text-[#ccc]">{children}</code>
        </pre>
        <button
          onClick={copy}
          className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-[#666] transition-opacity hover:bg-white/[0.1] hover:text-white md:opacity-0 md:group-hover:opacity-100"
        >
          {copied ? (
            <IconCheck className="size-3.5 text-green-400" />
          ) : (
            <IconCopy className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
