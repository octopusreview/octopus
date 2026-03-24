"use client";

import { useState, useCallback } from "react";
import { IconCopy, IconCheck, IconDownload } from "@tabler/icons-react";

export function SkillCodeBlock({
  children,
  title,
  filename,
}: {
  children: string;
  title?: string;
  filename: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  const download = useCallback(() => {
    const blob = new Blob([children], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [children, filename]);

  return (
    <div className="group relative mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
      {title && (
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-1.5">
          <span className="text-xs text-[#666]">{title}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#666] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              {copied ? (
                <>
                  <IconCheck className="size-3.5 text-green-400" />
                  Copied
                </>
              ) : (
                <>
                  <IconCopy className="size-3.5" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={download}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#666] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <IconDownload className="size-3.5" />
              Download
            </button>
          </div>
        </div>
      )}
      <div className="relative">
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words bg-[#161616] px-4 py-3">
          <code className="text-sm text-[#ccc]">{children}</code>
        </pre>
      </div>
    </div>
  );
}
