"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TrackedLink } from "@/components/tracked-link";
import { IconArrowRight, IconBook, IconBrandGithub, IconPalette, IconCoin } from "@tabler/icons-react";

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
          <Link href="/#features" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">Features</Link>
          <Link href="/#how-it-works" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">How It Works</Link>
          <Link href="/#faq" className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">FAQ</Link>

          {/* Resources dropdown */}
          <div
            className="relative"
            onMouseEnter={() => setResourcesOpen(true)}
            onMouseLeave={() => setResourcesOpen(false)}
          >
            <button className="rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-white">
              Resources
            </button>

            {/* Invisible bridge so mouse can travel from button to dropdown */}
            <div className="absolute left-0 right-0 h-3" />

            <div
              className={`absolute left-1/2 top-full pt-3 -translate-x-1/2 transition-all duration-150 ${
                resourcesOpen
                  ? "visible translate-y-0 opacity-100"
                  : "invisible -translate-y-1 opacity-0"
              }`}
            >
              <div className="w-56 rounded-xl border border-white/[0.08] bg-[#161616] p-2 shadow-xl shadow-black/30">
                <TrackedLink
                  href="/docs/getting-started"
                  event="nav_click"
                  eventParams={{ label: "docs" }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconBook className="size-4 shrink-0 text-[#555]" />
                  Documentation
                </TrackedLink>
                <TrackedLink
                  href="/brand"
                  event="nav_click"
                  eventParams={{ label: "brand" }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconPalette className="size-4 shrink-0 text-[#555]" />
                  Brand Guidelines
                </TrackedLink>
                <TrackedLink
                  href="/docs/pricing"
                  event="nav_click"
                  eventParams={{ label: "pricing" }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconCoin className="size-4 shrink-0 text-[#555]" />
                  Pricing
                </TrackedLink>
                <a
                  href="https://github.com/octopusreview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconBrandGithub className="size-4 shrink-0 text-[#555]" />
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="ml-2 shrink-0">
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
