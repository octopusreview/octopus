"use client";

import { useState } from "react";

export function CouponCode() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText("NOTARABBIT");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group mt-3 inline-flex items-center gap-2.5 rounded-lg border border-dashed border-[#10D8BE]/40 bg-[#10D8BE]/5 px-5 py-2.5 transition-all hover:border-[#10D8BE]/60 hover:bg-[#10D8BE]/10"
    >
      <code className="text-lg font-bold tracking-widest text-[#10D8BE]">
        NOTARABBIT
      </code>
      <span className="text-xs font-medium text-[#10D8BE]/60 transition-colors group-hover:text-[#10D8BE]">
        {copied ? "Copied!" : "Copy"}
      </span>
    </button>
  );
}
