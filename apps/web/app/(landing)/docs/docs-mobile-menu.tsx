"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/link";
import { IconMenu2 } from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type MenuItem = { href: string; label: string };
type MenuSection = { title: string; items: MenuItem[] };

const sections: MenuSection[] = [
  {
    title: "Get Started",
    items: [
      { href: "/docs/getting-started", label: "Introduction" },
      { href: "/docs/open-source", label: "Free for Open Source" },
      { href: "/docs/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Setup & Integrations",
    items: [
      { href: "/docs/github-action", label: "GitHub Action" },
      { href: "/docs/integrations", label: "Integrations" },
      { href: "/docs/self-hosting", label: "Self-Hosting" },
    ],
  },
  {
    title: "Features",
    items: [
      { href: "/docs/skills", label: "Skills" },
      { href: "/docs/cli", label: "CLI" },
      {
        href: "/docs/cli/claude-code-integration",
        label: "Claude Code Integration",
      },
      { href: "/docs/octopusignore", label: ".octopusignore" },
    ],
  },
  {
    title: "Resources",
    items: [
      { href: "/docs/about", label: "About" },
      { href: "/docs/glossary", label: "Glossary" },
      { href: "/docs/faq", label: "FAQ" },
      { href: "/docs/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Legal",
    items: [
      { href: "/docs/privacy", label: "Privacy Policy" },
      { href: "/docs/terms", label: "Terms & Conditions" },
      { href: "/docs/cookies", label: "Cookie Policy" },
      { href: "/docs/security", label: "Security & Bug Bounty" },
    ],
  },
];

export function DocsMobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="flex size-9 items-center justify-center rounded-lg text-[#666] transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
        aria-label="Open menu"
      >
        <IconMenu2 className="size-5" />
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton
        className="w-72 border-white/[0.06] bg-[#111] p-0"
      >
        <SheetHeader className="border-b border-white/[0.06] px-5 py-3">
          <SheetTitle className="text-sm font-semibold text-white">
            Docs
          </SheetTitle>
          <SheetDescription className="sr-only">
            Documentation navigation
          </SheetDescription>
        </SheetHeader>

        <nav className="space-y-6 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#555]">
                {section.title}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => {
                        trackEvent("docs_mobile_menu_click", {
                          label: item.label
                            .toLowerCase()
                            .replace(/[^a-z]/g, "_"),
                        });
                      }}
                      className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-white/[0.06] text-white"
                          : "text-[#888] hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
