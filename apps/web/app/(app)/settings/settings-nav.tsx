"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  IconSettings,
  IconUsers,
  IconKey,
  IconBrain,
  IconEye,
  IconCreditCard,
  IconPlug,
  IconFileText,
  IconTerminal2,
  IconBell,
  IconDevices,
  IconArrowUp,
} from "@tabler/icons-react";

// Self-hosted-only nav items are filtered out at render time when
// process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED !== "true".
const SELF_HOSTED_ONLY = new Set(["/settings/updates"]);
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true";

const sections = [
  {
    label: "Organization",
    items: [
      { href: "/settings", label: "General", icon: IconSettings },
      { href: "/settings/team", label: "Team", icon: IconUsers },
      { href: "/settings/billing", label: "Billing", icon: IconCreditCard },
      { href: "/settings/notifications", label: "Notifications", icon: IconBell },
    ],
  },
  {
    label: "AI & Reviews",
    items: [
      { href: "/settings/reviews", label: "Reviews", icon: IconEye },
      { href: "/settings/models", label: "Models", icon: IconBrain },
      { href: "/settings/api-keys", label: "Provider Keys", icon: IconKey },
    ],
  },
  {
    label: "Developer",
    items: [
      { href: "/settings/integrations", label: "Integrations", icon: IconPlug },
      { href: "/settings/api-tokens", label: "Auth Tokens", icon: IconTerminal2 },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/settings/sessions", label: "Sessions", icon: IconDevices },
    ],
  },
  {
    label: "System",
    items: [
      // Self-hosted-only — filtered at render via SELF_HOSTED_ONLY.
      { href: "/settings/updates", label: "Updates", icon: IconArrowUp },
    ],
  },
  {
    label: "Legal",
    items: [
      { href: "/settings/documents", label: "Documents", icon: IconFileText },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();

  // Strip self-hosted-only sections when we're not in self-hosted mode.
  // The pages themselves also gate, so this is defense-in-depth + cleaner UX.
  const visibleSections = sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => IS_SELF_HOSTED || !SELF_HOSTED_ONLY.has(i.href)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {visibleSections.map((section, sectionIndex) => (
        <div
          key={section.label}
          className={cn(
            "flex gap-1 md:flex-col",
            sectionIndex > 0 &&
              "border-l border-border/50 pl-2 md:border-l-0 md:pl-0 md:mt-4"
          )}
        >
          <span className="hidden md:block px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            {section.label}
          </span>
          {section.items.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/settings"
                ? pathname === "/settings"
                : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-stone-100 text-foreground dark:bg-stone-800"
                    : "text-muted-foreground hover:bg-stone-100/50 hover:text-foreground dark:hover:bg-stone-800/50"
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
