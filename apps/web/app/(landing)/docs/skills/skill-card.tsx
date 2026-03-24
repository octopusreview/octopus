"use client";

import { useState, useCallback } from "react";
import { IconChevronDown, IconDownload } from "@tabler/icons-react";

export function SkillCard({
  icon,
  title,
  subtitle,
  filename,
  content,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  filename: string;
  content: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const download = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const blob = new Blob([content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [content, filename],
  );

  return (
    <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-3 p-5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="text-sm text-[#666]">{subtitle}</p>
        </div>
        <button
          onClick={download}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-[#555] transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label={`Download ${filename}`}
        >
          <IconDownload className="size-3.5" />
          Download
        </button>
        <IconChevronDown
          className={`size-5 shrink-0 text-[#555] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>
      {open && (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}
