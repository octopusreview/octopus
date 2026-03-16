import Link from "next/link";
import Image from "next/image";
import {
  IconFileText,
  IconTerminal2,
  IconServer,
  IconArrowLeft,
} from "@tabler/icons-react";
import { TrackedLink } from "@/components/tracked-link";

const sidebarItems = [
  {
    href: "/docs/cli",
    label: "CLI",
    icon: IconTerminal2,
    description: "Installation & commands",
  },
  {
    href: "/docs/octopusignore",
    label: ".octopusignore",
    icon: IconFileText,
    description: "Exclude files from review",
  },
  {
    href: "/docs/self-hosting",
    label: "Self-Hosting",
    icon: IconServer,
    description: "Deploy on your infrastructure",
  },
];

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-[#0c0c0c] text-[#a0a0a0]">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0c0c0c]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <TrackedLink href="/" event="docs_nav_click" eventParams={{ label: "logo" }} className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Octopus" width={22} height={22} />
            <span className="text-sm font-semibold text-white">Octopus</span>
          </TrackedLink>
          <span className="text-[#333]">/</span>
          <span className="text-sm text-[#666]">Docs</span>
          <div className="ml-auto">
            <TrackedLink
              href="/"
              event="docs_nav_click"
              eventParams={{ label: "home" }}
              className="flex items-center gap-1.5 text-sm text-[#555] transition-colors hover:text-white"
            >
              <IconArrowLeft className="size-3.5" />
              Home
            </TrackedLink>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-0 px-6 py-8 lg:gap-12">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1">
            {sidebarItems.map((item) => (
              <TrackedLink
                key={item.href}
                href={item.href}
                event="docs_sidebar_click"
                eventParams={{ label: item.label.toLowerCase().replace(/[^a-z]/g, "_") }}
                className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <item.icon className="mt-0.5 size-4 shrink-0 text-[#555] transition-colors group-hover:text-white" />
                <div>
                  <div className="text-sm font-medium text-[#999] transition-colors group-hover:text-white">
                    {item.label}
                  </div>
                  <div className="text-xs text-[#444]">{item.description}</div>
                </div>
              </TrackedLink>
            ))}
          </nav>
        </aside>

        {/* Mobile nav */}
        <div className="mb-8 flex gap-2 overflow-x-auto lg:hidden">
          {sidebarItems.map((item) => (
            <TrackedLink
              key={item.href}
              href={item.href}
              event="docs_mobile_nav_click"
              eventParams={{ label: item.label.toLowerCase().replace(/[^a-z]/g, "_") }}
              className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2 text-sm text-[#888] transition-colors hover:border-white/[0.15] hover:text-white"
            >
              <item.icon className="size-3.5" />
              {item.label}
            </TrackedLink>
          ))}
        </div>

        {/* Content */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
