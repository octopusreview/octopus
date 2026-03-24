"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  IconMenu2,
  IconTerminal2,
  IconServer,
  IconPlugConnected,
  IconCreditCard,
  IconInfoCircle,
  IconQuestionMark,
  IconRocket,
  IconWand,
  IconBook2,
  IconShieldLock,
  IconScale,
  IconCookie,
} from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const sidebarItems = [
  { href: "/docs/getting-started", label: "Getting Started", icon: IconRocket },
  { href: "/docs/self-hosting", label: "Self-Hosting", icon: IconServer },
  { href: "/docs/integrations", label: "Integrations", icon: IconPlugConnected },
  { href: "/docs/skills", label: "Skills", icon: IconWand },
  { href: "/docs/cli", label: "CLI", icon: IconTerminal2 },
  { href: "/docs/pricing", label: "Pricing", icon: IconCreditCard },
  { href: "/docs/about", label: "About", icon: IconInfoCircle },
  { href: "/docs/glossary", label: "Glossary", icon: IconBook2 },
  { href: "/docs/faq", label: "FAQ", icon: IconQuestionMark },
];

const legalItems = [
  { href: "/docs/privacy", label: "Privacy Policy", icon: IconShieldLock },
  { href: "/docs/terms", label: "Terms & Conditions", icon: IconScale },
  { href: "/docs/cookies", label: "Cookie Policy", icon: IconCookie },
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

        <nav className="overflow-y-auto px-3 py-4">
          <div className="space-y-0.5">
            {sidebarItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    trackEvent("docs_mobile_menu_click", {
                      label: item.label.toLowerCase().replace(/[^a-z]/g, "_"),
                    });
                  }}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    active
                      ? "bg-white/[0.06] text-white"
                      : "text-[#888] hover:bg-white/[0.04] hover:text-white"
                  }`}
                >
                  <item.icon
                    className={`size-4 shrink-0 ${active ? "text-white" : "text-[#555]"}`}
                  />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#444]">
              Legal
            </span>
            <div className="mt-2 space-y-0.5">
              {legalItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => {
                      trackEvent("docs_mobile_menu_click", {
                        label: item.label
                          .toLowerCase()
                          .replace(/[^a-z ]/g, "")
                          .replace(/ /g, "_"),
                      });
                    }}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      active
                        ? "bg-white/[0.06] text-white"
                        : "text-[#666] hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <item.icon
                      className={`size-4 shrink-0 ${active ? "text-white" : "text-[#444]"}`}
                    />
                    <span className="text-sm">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
