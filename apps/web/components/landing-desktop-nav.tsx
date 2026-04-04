"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TrackedLink } from "@/components/tracked-link";
import { IconArrowRight, IconBook, IconBrandGithub, IconBug, IconCoin, IconNews, IconMessageCircle } from "@tabler/icons-react";

export function LandingDesktopNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [resourcesOpen, setResourcesOpen] = useState(false);

  return (
    <nav className="fixed left-1/2 top-4 z-40 hidden -translate-x-1/2 lg:block">
      <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 shadow-lg shadow-black/20 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 px-2">
          <Image src="/logo.svg" alt="Octopus" width={24} height={24} priority />
          <span className="text-sm font-semibold tracking-tight text-white">Octopus</span>
        </Link>
        <div className="flex items-center gap-1 whitespace-nowrap pl-4 text-sm text-[#777]">
          <Link href="/#how-it-works" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">How It Works</Link>
          <Link href="/#features" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">Features</Link>
          <Link href="/#faq" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">FAQ</Link>

          {/* Resources dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setResourcesOpen(true)}
            onMouseLeave={() => setResourcesOpen(false)}
            onFocus={() => setResourcesOpen(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setResourcesOpen(false);
              }
            }}
          >
            <button
              type="button"
              aria-expanded={resourcesOpen}
              aria-haspopup="true"
              className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Resources
            </button>

            {/* Invisible bridge so mouse can travel from button to dropdown */}
            <div className="absolute -left-8 -right-8 h-3" />

            <div
              className={`absolute left-1/2 top-full pt-3 -translate-x-1/2 transition-all duration-150 ${
                resourcesOpen
                  ? "visible translate-y-0 opacity-100"
                  : "invisible -translate-y-1 opacity-0"
              }`}
            >
              <div className="grid w-[480px] grid-cols-2 gap-0.5 rounded-xl border border-white/[0.08] bg-[#161616] p-2 shadow-xl shadow-black/30">
                <TrackedLink
                  href="/docs/getting-started"
                  event="nav_click"
                  eventParams={{ label: "docs" }}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconBook className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Documentation</div>
                    <div className="mt-0.5 text-xs text-[#555]">Setup guides & API reference</div>
                  </div>
                </TrackedLink>
                <TrackedLink
                  href="/brand"
                  event="nav_click"
                  eventParams={{ label: "brand" }}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <Image src="/logo.svg" alt="" width={20} height={20} className="mt-0.5 shrink-0 opacity-40 grayscale" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Brand Guidelines</div>
                    <div className="mt-0.5 text-xs text-[#555]">Logos, colors & assets</div>
                  </div>
                </TrackedLink>
                <TrackedLink
                  href="/blog"
                  event="nav_click"
                  eventParams={{ label: "blog" }}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconNews className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Blog</div>
                    <div className="mt-0.5 text-xs text-[#555]">News & product updates</div>
                  </div>
                </TrackedLink>
                <TrackedLink
                  href="/docs/pricing"
                  event="nav_click"
                  eventParams={{ label: "pricing" }}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconCoin className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Pricing</div>
                    <div className="mt-0.5 text-xs text-[#555]">Plans & credit packages</div>
                  </div>
                </TrackedLink>
                <a
                  href="https://github.com/octopusreview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconBrandGithub className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">GitHub</div>
                    <div className="mt-0.5 text-xs text-[#555]">Source code & issues</div>
                  </div>
                </a>
                <TrackedLink
                  href="/docs/changelog"
                  event="nav_click"
                  eventParams={{ label: "changelog" }}
                  className="flex items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconNews className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Changelog</div>
                    <div className="mt-0.5 text-xs text-[#555]">What&apos;s new in Octopus</div>
                  </div>
                </TrackedLink>
                <TrackedLink
                  href="/bug-bounty"
                  event="nav_click"
                  eventParams={{ label: "bug_bounty" }}
                  className="col-span-2 inline-flex w-fit items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.06]"
                >
                  <IconBug className="mt-0.5 size-5 shrink-0 text-[#555]" />
                  <div>
                    <div className="text-sm font-medium text-[#ccc]">Bug Bounty</div>
                    <div className="mt-0.5 text-xs text-[#555]">Report vulnerabilities & earn rewards</div>
                  </div>
                </TrackedLink>
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={() => window.dispatchEvent(new Event("ask-octopus-open"))}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-[#777] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconMessageCircle className="size-3.5 text-[#10D8BE]" />
          Ask AI
        </button>
        <div className="shrink-0">
          {isLoggedIn ? (
            <Link href="/dashboard" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]">
              Dashboard
              <IconArrowRight className="size-3.5" />
            </Link>
          ) : (
            <TrackedLink href="/login" event="cta_click" eventParams={{ location: "desktop_nav", label: "get_started" }} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0c0c0c] transition-colors hover:bg-[#e0e0e0]">
              Get Started
              <IconArrowRight className="size-3.5" />
            </TrackedLink>
          )}
        </div>
      </div>
    </nav>
  );
}
