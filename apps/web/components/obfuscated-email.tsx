"use client";

import { useCallback } from "react";
import { IconMail } from "@tabler/icons-react";

/**
 * Anti-bot email display.
 * - Text is rendered reversed in DOM, CSS flips it visually.
 * - The real address is assembled in JS only on click (mailto:).
 * - Bots see neither a plain-text address nor a mailto: href in HTML.
 */
export function ObfuscatedEmail({
  showIcon = true,
  className = "",
  children,
}: {
  showIcon?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const u = "olleh";
    const d = "ia.weiver-supotco";
    const addr = u.split("").reverse().join("") + "@" + d.split("").reverse().join("");
    window.location.href = "mailto:" + addr;
  }, []);

  return (
    <a
      href="#contact"
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 ${className}`}
      aria-label="Send email"
    >
      {showIcon && <IconMail className="size-3.5" />}
      {children ?? (
        <span className="select-all" style={{ direction: "rtl", unicodeBidi: "bidi-override" }}>
          ia.weiver-supotco@olleh
        </span>
      )}
    </a>
  )
}
