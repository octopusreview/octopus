"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { TrackedLink } from "@/components/tracked-link";
import { IconMenu2, IconX, IconBrandGithub, IconBook, IconPalette, IconCoin } from "@tabler/icons-react";

export function LandingMobileNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed left-0 right-0 top-0 z-40 border-b border-white/[0.06] bg-[#0c0c0c]/80 backdrop-blur-xl lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Image src="/logo.svg" alt="Octopus" width={22} height={22} priority />
          <span className="text-sm font-semibold text-white">Octopus</span>
        </div>
        <div className="flex items-center gap-2">
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
                href="#features"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                How It Works
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
                <TrackedLink
                  href="/docs/getting-started"
                  event="nav_click"
                  eventParams={{ label: "docs" }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconBook className="size-4 text-[#555]" />
                  Documentation
                </TrackedLink>
                <TrackedLink
                  href="/brand"
                  event="nav_click"
                  eventParams={{ label: "brand" }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconPalette className="size-4 text-[#555]" />
                  Brand Guidelines
                </TrackedLink>
                <TrackedLink
                  href="/docs/pricing"
                  event="nav_click"
                  eventParams={{ label: "pricing" }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconCoin className="size-4 text-[#555]" />
                  Pricing
                </TrackedLink>
                <a
                  href="https://github.com/octopusreview"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#888] transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconBrandGithub className="size-4 text-[#555]" />
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
