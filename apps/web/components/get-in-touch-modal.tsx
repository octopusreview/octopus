"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  IconBrandGithub,
  IconBrandDiscord,
  IconMail,
  IconQuestionMark,
  IconMessageCircle,
  IconBug,
  IconX,
} from "@tabler/icons-react";
import { ObfuscatedEmail } from "@/components/obfuscated-email";
import Link from "next/link";

const DISCORD_INVITE_URL = "https://discord.gg/qyuWTXghbS";

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

function ContactContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-[#888]">
        Whether you have a question about Octopus, need help with setup, want to
        report a bug, or are interested in a partnership — we&apos;d love to hear
        from you. Pick the channel that works best for you.
      </p>

      {/* Direct contact */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#555]">
          <IconMessageCircle className="size-3" />
          Reach Out Directly
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.15]">
            <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#666] transition-colors group-hover:text-white">
              <IconMail className="size-4" />
            </div>
            <ObfuscatedEmail
              showIcon={false}
              className="text-sm font-medium text-[#ccc] transition-colors hover:text-white"
            />
            <p className="mt-1 text-xs leading-relaxed text-[#555]">
              General inquiries, partnerships, and support requests.
            </p>
          </div>

          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.15]"
          >
            <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#666] transition-colors group-hover:text-white">
              <IconBrandDiscord className="size-4" />
            </div>
            <span className="text-sm font-medium text-[#ccc]">Discord Community</span>
            <p className="mt-1 text-xs leading-relaxed text-[#555]">
              Chat with the community, get help, and share feedback in real time.
            </p>
          </a>
        </div>
      </div>

      {/* Technical */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[#555]">
          <IconBug className="size-3" />
          Technical
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a
            href="https://github.com/octopusreview/octopus/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.15]"
          >
            <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#666] transition-colors group-hover:text-white">
              <IconBrandGithub className="size-4" />
            </div>
            <span className="text-sm font-medium text-[#ccc]">GitHub Issues</span>
            <p className="mt-1 text-xs leading-relaxed text-[#555]">
              Bug reports, feature requests, and technical discussions.
            </p>
          </a>

          <Link
            href="/docs/faq"
            onClick={onClose}
            className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.15]"
          >
            <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#666] transition-colors group-hover:text-white">
              <IconQuestionMark className="size-4" />
            </div>
            <span className="text-sm font-medium text-[#ccc]">FAQ</span>
            <p className="mt-1 text-xs leading-relaxed text-[#555]">
              Common questions about pricing, self-hosting, and integrations.
            </p>
          </Link>
        </div>
      </div>

      <p className="text-xs text-[#444]">
        We typically respond to emails within 24 hours. For faster help, try Discord.
      </p>
    </div>
  );
}

function ModalPortal({
  open,
  onClose,
  isMobile,
}: {
  open: boolean;
  onClose: () => void;
  isMobile: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      const timer = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-200 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Content */}
      {isMobile ? (
        /* Bottom sheet */
        <div
          ref={contentRef}
          className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/[0.06] bg-[#141414] px-6 pb-8 pt-2 transition-transform duration-200 ease-out ${
            visible ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/[0.1]" />
          <h2 className="mb-4 font-medium text-white">Get in Touch</h2>
          <ContactContent onClose={onClose} />
        </div>
      ) : (
        /* Center dialog */
        <div className="flex min-h-full items-center justify-center p-4">
          <div
            ref={contentRef}
            className={`relative w-full max-w-lg rounded-xl border border-white/[0.06] bg-[#141414] p-6 shadow-2xl transition-all duration-200 ${
              visible
                ? "scale-100 opacity-100"
                : "scale-95 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 rounded-md p-1 text-[#555] transition-colors hover:text-white"
            >
              <IconX className="size-4" />
              <span className="sr-only">Close</span>
            </button>
            <h2 className="mb-4 font-medium text-white">Get in Touch</h2>
            <ContactContent onClose={onClose} />
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

export function GetInTouchModal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <ModalPortal open={open} onClose={close} isMobile={isMobile} />
    </>
  );
}
