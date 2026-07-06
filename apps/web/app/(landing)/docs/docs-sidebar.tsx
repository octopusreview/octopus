"use client";

import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "@/components/link";
import { trackEvent } from "@/lib/analytics";
import { DocsSearch } from "./docs-search";

type SidebarItem = {
  href: string;
  label: string;
  children?: { href: string; label: string; icon?: string }[];
};

type SidebarSection = {
  title: string;
  items: SidebarItem[];
};

const sections: SidebarSection[] = [
  {
    title: "Get Started",
    items: [
      { href: "/docs/getting-started", label: "Introduction" },
      { href: "/docs/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Cloud Setup",
    items: [
      { href: "/docs/github-action", label: "GitHub Action" },
      { href: "/docs/integrations", label: "Integrations" },
    ],
  },
  {
    title: "Self-Host",
    items: [
      { href: "/docs/self-hosting", label: "Self-Hosting" },
      { href: "/docs/github-app", label: "GitHub App (self-host)" },
      { href: "/docs/oauth-setup", label: "Google & GitHub Login" },
    ],
  },
  {
    title: "Features",
    items: [
      { href: "/docs/skills", label: "Skills" },
      {
        href: "/docs/cli",
        label: "CLI",
        children: [
          {
            href: "/docs/cli/claude-code-integration",
            label: "Claude Code Integration",
            icon: "/claude-color.svg",
          },
        ],
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
  {
    title: "Compliance",
    items: [
      { href: "/docs/security-overview", label: "Security Overview" },
      { href: "/docs/dpa", label: "Data Processing Addendum" },
      { href: "/docs/sub-processors", label: "Sub-processors" },
      { href: "/docs/data-retention", label: "Data Retention" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pr-2">
      <DocsSearch />

      {sections.map((section) => (
        <div key={section.title}>
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#555]">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      trackEvent("docs_sidebar_click", {
                        label: item.label.toLowerCase().replace(/[^a-z]/g, "_"),
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
                  {item.children && (
                    <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-white/[0.06] pl-3">
                      {item.children.map((child) => {
                        const cActive = pathname === child.href;
                        return (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              onClick={() => {
                                trackEvent("docs_sidebar_click", {
                                  label: child.label
                                    .toLowerCase()
                                    .replace(/[^a-z]/g, "_"),
                                });
                              }}
                              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                                cActive
                                  ? "text-white"
                                  : "text-[#666] hover:text-white"
                              }`}
                            >
                              {child.icon && (
                                <Image
                                  src={child.icon}
                                  alt=""
                                  width={14}
                                  height={14}
                                  className="shrink-0"
                                />
                              )}
                              {child.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
