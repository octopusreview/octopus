"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  IconFileText,
  IconTerminal2,
  IconServer,
  IconPlugConnected,
  IconCreditCard,
  IconInfoCircle,
  IconShieldLock,
  IconScale,
  IconCookie,
  IconQuestionMark,
  IconSearch,
  IconHeartHandshake,
} from "@tabler/icons-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";

const docsPages = [
  {
    href: "/docs/open-source",
    label: "Free for Open Source",
    description: "Unlimited AI reviews for public OSS repos via the GitHub Action.",
    icon: IconHeartHandshake,
    keywords: ["open source", "oss", "free", "github action", "workflow", "yaml", "public repo", "maintainer"],
  },
  {
    href: "/docs/self-hosting",
    label: "Self-Hosting",
    description: "Deploy on your infrastructure. Docker, prerequisites, environment variables.",
    icon: IconServer,
    keywords: ["deploy", "docker", "server", "install", "setup", "postgres", "qdrant"],
  },
  {
    href: "/docs/integrations",
    label: "Integrations",
    description: "GitHub, Bitbucket, Slack, Linear connections and webhooks.",
    icon: IconPlugConnected,
    keywords: ["github", "bitbucket", "slack", "linear", "webhook", "oauth"],
  },
  {
    href: "/docs/cli",
    label: "CLI",
    description: "Installation, commands, authentication, and profiles.",
    icon: IconTerminal2,
    keywords: ["terminal", "command", "npm", "bun", "login", "review", "index", "chat"],
  },
  {
    href: "/docs/octopusignore",
    label: ".octopusignore",
    description: "Exclude files and directories from code review.",
    icon: IconFileText,
    keywords: ["ignore", "exclude", "filter", "pattern", "glob"],
  },
  {
    href: "/docs/pricing",
    label: "Pricing",
    description: "Credits, billing, BYO keys, and usage limits.",
    icon: IconCreditCard,
    keywords: ["price", "cost", "credit", "billing", "plan", "free", "pro", "enterprise"],
  },
  {
    href: "/docs/about",
    label: "About",
    description: "The story behind Octopus.",
    icon: IconInfoCircle,
    keywords: ["story", "team", "mission", "why"],
  },
  {
    href: "/docs/faq",
    label: "FAQ",
    description: "Frequently asked questions about Octopus.",
    icon: IconQuestionMark,
    keywords: ["faq", "question", "help", "support", "how", "what", "why"],
  },
  {
    href: "/docs/privacy",
    label: "Privacy Policy",
    description: "How we handle your data and privacy.",
    icon: IconShieldLock,
    keywords: ["data", "gdpr", "privacy", "personal"],
  },
  {
    href: "/docs/terms",
    label: "Terms & Conditions",
    description: "Terms of service and usage agreement.",
    icon: IconScale,
    keywords: ["terms", "service", "agreement", "legal"],
  },
  {
    href: "/docs/cookies",
    label: "Cookie Policy",
    description: "Cookie usage and tracking information.",
    icon: IconCookie,
    keywords: ["cookie", "tracking", "analytics"],
  },
];

export function DocsSearch() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-left text-sm text-[#555] transition-colors hover:border-white/[0.12] hover:text-[#888]"
      >
        <IconSearch className="size-3.5 shrink-0" />
        <span className="flex-1">Search docs...</span>
        <kbd className="hidden rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-[#555] sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search documentation..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Documentation">
            {docsPages.map((page) => (
              <CommandItem
                key={page.href}
                value={`${page.label} ${page.description} ${page.keywords.join(" ")}`}
                onSelect={() => handleSelect(page.href)}
                className="gap-3 py-2.5"
              >
                <page.icon className="size-4 shrink-0 text-[#666]" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{page.label}</div>
                  <div className="truncate text-xs text-[#666]">
                    {page.description}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
