"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  IconLayoutDashboard,
  IconUsers,
  IconBuilding,
  IconBrain,
  IconChartBar,
  IconEye,
  IconRobot,
  IconPackage,
} from "@tabler/icons-react";

const items = [
  { href: "/admin", label: "Overview", icon: IconLayoutDashboard },
  { href: "/admin/users", label: "Users", icon: IconUsers },
  { href: "/admin/organizations", label: "Organizations", icon: IconBuilding },
  { href: "/admin/usage", label: "AI Usage", icon: IconChartBar },
  { href: "/admin/models", label: "Models", icon: IconBrain },
  { href: "/admin/review-defaults", label: "Review Defaults", icon: IconEye },
  { href: "/admin/blocked-authors", label: "Blocked Authors", icon: IconRobot },
  { href: "/admin/safe-packages", label: "Safe Packages", icon: IconPackage },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map(({ href, label, icon: Icon }) => {
        const isActive =
          href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

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
    </nav>
  );
}
