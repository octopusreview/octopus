"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TrackedLink } from "@/components/tracked-link";
import { IconMenu2, IconX, IconBrandGithub, IconBook, IconBug, IconCoin, IconNews, IconMessageCircle } from "@tabler/icons-react";

export function LandingMobileNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed left-0 right-0 top-0 z-40 border-b border-white/[0.06] bg-[#0c0c0c]/80 backdrop-blur-xl lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="Octopus" width={22} height={22} priority />
          <span className="text-sm font-semibold text-white">Octopus</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new Event("ask-octopus-open"))}
            className="flex items-center gap-1 rounded-full border border-white/[0.08] px-3 py-1.5 text-xs text-[#888] transition-colors hover:border-[#10D8BE]/30 hover:text-white"
          >
            <IconMessageCircle className="size-3 text-[#10D8BE]" />
            Ask AI
          </button>
          {isLoggedIn ? (
            <Link href="/dashboard" className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-[#0c0c0c]">
              Dashboard
            </Link>
          ) : (
            <TrackedLink href="/login" event="cta_click" eventParams={{ location: "mobile_nav", label: "get_started" }} className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-[#0c0c0c]">
              Get Started
            </TrackedLink>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="flex size-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <IconX className="size-5" /> : <IconMenu2 className="size-5" />}
          </button>
        </div>
      </div>

      {/* Dropdown menu — grid-rows trick for smooth height animation */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/[0.06] bg-[#0c0c0c]/95 px-4 pb-4 pt-2 backdrop-blur-xl">
            <div className="flex flex-col gap-1">
              <a
                href="#how-it-works"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                How It Works
              </a>
              <a
                href="#features"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Features
              </a>
              <a
                href="#faq"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                FAQ
              </a>

              {/* Resources */}
              <div className="mt-2 border-t border-white/[0.06] pt-2">
                <span className="px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-[#444]">Resources</span>
                <div className="mt-1.5 grid grid-cols-2 gap-0.5">
                  <TrackedLink
                    href="/docs/getting-started"
                    event="nav_click"
                    eventParams={{ label: "docs" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconBook className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Documentation</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">Setup guides & API reference</div>
                    </div>
                  </TrackedLink>
                  <TrackedLink
                    href="/brand"
                    event="nav_click"
                    eventParams={{ label: "brand" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <Image src="/logo.svg" alt="" width={16} height={16} className="mt-0.5 shrink-0 opacity-40 grayscale" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Brand Guidelines</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">Logos, colors & assets</div>
                    </div>
                  </TrackedLink>
                  <TrackedLink
                    href="/blog"
                    event="nav_click"
                    eventParams={{ label: "blog" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconNews className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Blog</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">News & product updates</div>
                    </div>
                  </TrackedLink>
                  <TrackedLink
                    href="/docs/pricing"
                    event="nav_click"
                    eventParams={{ label: "pricing" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconCoin className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Pricing</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">Plans & credit packages</div>
                    </div>
                  </TrackedLink>
                  <a
                    href="https://github.com/octopusreview"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconBrandGithub className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">GitHub</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">Source code & issues</div>
                    </div>
                  </a>
                  <TrackedLink
                    href="/docs/changelog"
                    event="nav_click"
                    eventParams={{ label: "changelog" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconNews className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Changelog</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">What&apos;s new in Octopus</div>
                    </div>
                  </TrackedLink>
                  <TrackedLink
                    href="/bug-bounty"
                    event="nav_click"
                    eventParams={{ label: "bug_bounty" }}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                  >
                    <IconBug className="mt-0.5 size-4 shrink-0 text-[#555]" />
                    <div>
                      <div className="text-sm font-medium text-[#ccc]">Bug Bounty</div>
                      <div className="mt-0.5 text-[11px] text-[#555]">Report vulnerabilities & earn rewards</div>
                    </div>
                  </TrackedLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
