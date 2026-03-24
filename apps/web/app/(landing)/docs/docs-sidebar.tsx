"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  IconRocket,
  IconTerminal2,
  IconServer,
  IconPlugConnected,
  IconCreditCard,
  IconInfoCircle,
  IconShieldLock,
  IconScale,
  IconCookie,
  IconQuestionMark,
  IconWand,
  IconBook2,
} from "@tabler/icons-react";
import { trackEvent } from "@/lib/analytics";
import { DocsSearch } from "./docs-search";

const sidebarItems = [
  { href: "/docs/getting-started", label: "Getting Started", icon: IconRocket, description: "Connect your repo, first review" },
  { href: "/docs/self-hosting", label: "Self-Hosting", icon: IconServer, description: "Deploy on your infrastructure" },
  { href: "/docs/integrations", label: "Integrations", icon: IconPlugConnected, description: "GitHub, Bitbucket, Slack, Linear" },
  { href: "/docs/skills", label: "Skills", icon: IconWand, description: "AI-powered automation workflows" },
  { href: "/docs/cli", label: "CLI", icon: IconTerminal2, description: "Installation & commands" },
  { href: "/docs/pricing", label: "Pricing", icon: IconCreditCard, description: "Credits, billing & BYO keys" },
  { href: "/docs/about", label: "About", icon: IconInfoCircle, description: "The story behind Octopus" },
  { href: "/docs/glossary", label: "Glossary", icon: IconBook2, description: "Key terms & definitions" },
  { href: "/docs/faq", label: "FAQ", icon: IconQuestionMark, description: "Frequently asked questions" },
];

const legalItems = [
  { href: "/docs/privacy", label: "Privacy Policy", icon: IconShieldLock },
  { href: "/docs/terms", label: "Terms & Conditions", icon: IconScale },
  { href: "/docs/cookies", label: "Cookie Policy", icon: IconCookie },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-20 space-y-1">
      <div className="mb-4">
        <DocsSearch />
      </div>

      {sidebarItems.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              trackEvent("docs_sidebar_click", {
                label: item.label.toLowerCase().replace(/[^a-z]/g, "_"),
              });
            }}
            className={`group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
              active
                ? "bg-white/[0.06] text-white"
                : "hover:bg-white/[0.04]"
            }`}
          >
            <item.icon
              className={`mt-0.5 size-4 shrink-0 transition-colors ${
                active ? "text-white" : "text-[#555] group-hover:text-white"
              }`}
            />
            <div>
              <div
                className={`text-sm font-medium transition-colors ${
                  active ? "text-white" : "text-[#999] group-hover:text-white"
                }`}
              >
                {item.label}
              </div>
              <div className="text-xs text-[#444]">{item.description}</div>
            </div>
          </Link>
        );
      })}

      <div className="mt-6 border-t border-white/[0.06] pt-4">
        <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#444]">
          Legal
        </div>
        {legalItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                trackEvent("docs_sidebar_click", {
                  label: item.label.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, "_"),
                });
              }}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                active
                  ? "bg-white/[0.06] text-white"
                  : "hover:bg-white/[0.04]"
              }`}
            >
              <item.icon
                className={`size-3.5 shrink-0 transition-colors ${
                  active ? "text-white" : "text-[#444] group-hover:text-white"
                }`}
              />
              <span
                className={`text-sm transition-colors ${
                  active ? "text-white" : "text-[#666] group-hover:text-white"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
