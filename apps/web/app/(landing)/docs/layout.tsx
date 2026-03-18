import Image from "next/image";
import { IconArrowLeft } from "@tabler/icons-react";
import { TrackedLink } from "@/components/tracked-link";
import { DocsBreadcrumb } from "./docs-breadcrumb";
import { DocsMobileMenu } from "./docs-mobile-menu";
import { DocsSidebar } from "./docs-sidebar";
import { LandingFooter } from "@/components/landing-footer";

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
          <DocsMobileMenu />
          <TrackedLink
            href="/"
            event="docs_nav_click"
            eventParams={{ label: "logo" }}
            className="flex items-center gap-2"
          >
            <Image src="/logo.svg" alt="Octopus" width={22} height={22} />
            <span className="text-sm font-semibold text-white">Octopus</span>
          </TrackedLink>
          <span className="text-[#333]">/</span>
          <TrackedLink
            href="/docs/about"
            event="docs_nav_click"
            eventParams={{ label: "docs" }}
            className="text-sm text-[#666] transition-colors hover:text-white"
          >
            Docs
          </TrackedLink>
          <DocsBreadcrumb />
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

      <div className="mx-auto flex max-w-7xl px-6 py-8 lg:gap-12">
        {/* Desktop sidebar */}
        <aside className="w-56 shrink-0 max-lg:hidden">
          <DocsSidebar />
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <LandingFooter />
    </div>
  );
}
