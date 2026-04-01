"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  IconLayoutDashboard,
  IconUsers,
  IconBuilding,
  IconWorld,
  IconChartBar,
  IconBrain,
  IconEye,
  IconRobot,
  IconPackage,
  IconNews,
  IconDatabase,
  IconMessageCircle,
  IconHistory,
  IconHeartbeat,
  IconMail,
  IconSend,
  IconClockPlay,
} from "@tabler/icons-react";

const sections = [
  {
    label: "General",
    items: [
      { href: "/admin", label: "Overview", icon: IconLayoutDashboard },
      { href: "/admin/users", label: "Users", icon: IconUsers },
      { href: "/admin/organizations", label: "Organizations", icon: IconBuilding },
      { href: "/admin/community", label: "Community", icon: IconWorld },
    ],
  },
  {
    label: "AI & Reviews",
    items: [
      { href: "/admin/usage", label: "AI Usage", icon: IconChartBar },
      { href: "/admin/models", label: "Models", icon: IconBrain },
      { href: "/admin/review-defaults", label: "Review Defaults", icon: IconEye },
      { href: "/admin/blocked-authors", label: "Blocked Authors", icon: IconRobot },
      { href: "/admin/safe-packages", label: "Safe Packages", icon: IconPackage },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/blog", label: "Blog Posts", icon: IconNews },
      { href: "/admin/seed-docs", label: "Seed Docs", icon: IconDatabase },
      { href: "/admin/email-templates", label: "Email Templates", icon: IconMail },
      { href: "/admin/send-email", label: "Send Email", icon: IconSend },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/ask-octopus-logs", label: "Ask Octopus Logs", icon: IconMessageCircle },
      { href: "/admin/jobs", label: "Jobs", icon: IconClockPlay },
      { href: "/admin/audit-log", label: "Audit Log", icon: IconHistory },
      { href: "/admin/status", label: "Status Page", icon: IconHeartbeat },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0">
      {sections.map((section, i) => (
        <div key={section.label} className={cn(i > 0 && "mt-4")}>
          <div className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 md:block">
            {section.label}
          </div>
          {section.items.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-stone-100 text-foreground dark:bg-stone-800"
                    : "text-muted-foreground hover:bg-stone-100/50 hover:text-foreground dark:hover:bg-stone-800/50",
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
