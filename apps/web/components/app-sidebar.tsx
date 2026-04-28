"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/user-menu";
import { UserAvatar } from "@/components/user-avatar";
import { OrgSwitcher } from "@/components/org-switcher";
import { useChat } from "@/components/chat-provider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  IconLayoutDashboard,
  IconGitBranch,
  IconSettings,
  IconMessageChatbot,
  IconBook,
  IconMenu2,
  IconTimeline,
  IconChartBar,
  IconSearch,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconBug,
  IconFileText,
  IconTicket,
  IconHelpCircle,
  IconExternalLink,
  IconSparkles,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/command-palette";
import { CouponDialog } from "@/components/coupon-dialog";

const mainNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: IconGitBranch },
  { href: "/issues", label: "Issues", icon: IconBug },
  { href: "/review-logs", label: "Review Logs", icon: IconFileText },
  { href: "/timeline", label: "Timeline", icon: IconTimeline },
];

const bottomNavItems = [
  { href: "/usage", label: "Usage", icon: IconChartBar },
];

type Org = { id: string; name: string; avatarUrl?: string | null };

type SidebarProps = {
  user: { name: string; email: string };
  orgs: Org[];
  currentOrg: Org;
  canCreateOrg?: boolean;
};

const ASK_PHRASES = [
  "Ask anything",
  "What changed today?",
  "Find a bug",
  "Explain this PR",
  "Summarize my repo",
];

function RotatingLabel({ phrases }: { phrases: string[] }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;

    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let tick: number | null = null;
    let fade: number | null = null;

    const start = () => {
      if (tick !== null) return;
      tick = window.setInterval(() => {
        setVisible(false);
        fade = window.setTimeout(() => {
          setIndex((i) => (i + 1) % phrases.length);
          setVisible(true);
          fade = null;
        }, 300);
      }, 3200);
    };

    const stop = () => {
      if (tick !== null) {
        window.clearInterval(tick);
        tick = null;
      }
      if (fade !== null) {
        window.clearTimeout(fade);
        fade = null;
      }
      setVisible(true);
    };

    if (!mql?.matches) start();

    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) stop();
      else start();
    };
    mql?.addEventListener?.("change", onChange);

    return () => {
      stop();
      mql?.removeEventListener?.("change", onChange);
    };
  }, [phrases]);

  return (
    <span
      className={cn(
        "inline-block transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {phrases[index]}
    </span>
  );
}

function SidebarTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const helpLinks = [
  { href: "/docs/self-hosting", label: "Self-Hosting" },
  { href: "/docs/integrations", label: "Integrations" },
  { href: "/docs/cli", label: "CLI" },
  { href: "/docs/faq", label: "FAQ" },
  { href: "/docs/pricing", label: "Pricing" },
  { href: "/docs/changelog", label: "Changelog" },
  { href: "/docs/about", label: "About" },
];

function HelpMenuContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="space-y-1">
      <Link
        href="/"
        target="_blank"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
      >
        <IconExternalLink className="size-4 shrink-0" />
        Homepage
      </Link>
      <Link
        href="/blog"
        target="_blank"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
      >
        <IconExternalLink className="size-4 shrink-0" />
        Blog
      </Link>
      <div className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">Documentation</div>
      {helpLinks.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          target="_blank"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function HelpMenu({ collapsed, isMobile }: { collapsed?: boolean; isMobile?: boolean }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const triggerButton = collapsed ? (
    <button className="flex w-full items-center justify-center rounded-md px-2 py-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50">
      <IconHelpCircle className="size-4 shrink-0" />
    </button>
  ) : (
    <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50">
      <IconHelpCircle className="size-4 shrink-0" />
      Resources
    </button>
  );

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
        >
          <IconHelpCircle className="size-4 shrink-0" />
          Resources
        </button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-xl px-4 pb-6 pt-4" showCloseButton={false}>
            <SheetTitle className="text-sm font-semibold">Resources</SheetTitle>
            <HelpMenuContent onNavigate={() => setSheetOpen(false)} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {triggerButton}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right" sideOffset={8}>
            Resources
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent side="right" align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href="/" target="_blank">
            <IconExternalLink className="size-4" />
            Homepage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/blog" target="_blank">
            <IconExternalLink className="size-4" />
            Blog
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Documentation</DropdownMenuLabel>
        <DropdownMenuGroup>
          {helpLinks.map(({ href, label }) => (
            <DropdownMenuItem key={href} asChild>
              <Link href={href} target="_blank">
                {label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContent({
  user,
  orgs,
  currentOrg,
  canCreateOrg,
  collapsed,
  onToggleCollapse,
  onNavigate,
}: SidebarProps & { collapsed?: boolean; onToggleCollapse?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const chat = useChat();
  const [couponOpen, setCouponOpen] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-sidebar text-sidebar-foreground">
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 border-b py-3">
          {onToggleCollapse && (
            <SidebarTooltip label="Expand sidebar">
              <button
                onClick={onToggleCollapse}
                className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
              >
                <IconLayoutSidebarLeftExpand className="size-4" />
              </button>
            </SidebarTooltip>
          )}
          <SidebarTooltip label={currentOrg.name}>
            <div>
              <OrgSwitcher orgs={orgs} currentOrg={currentOrg} canCreateOrg={canCreateOrg} collapsed />
            </div>
          </SidebarTooltip>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-3">
            <div className="min-w-0 flex-1">
              <OrgSwitcher orgs={orgs} currentOrg={currentOrg} canCreateOrg={canCreateOrg} />
            </div>
            {onToggleCollapse && (
              <SidebarTooltip label="Collapse sidebar">
                <button
                  onClick={onToggleCollapse}
                  className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  <IconLayoutSidebarLeftCollapse className="size-4" />
                </button>
              </SidebarTooltip>
            )}
          </div>

          <div className="border-b px-3 py-2">
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
              className="flex w-full items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <IconSearch className="size-3.5" />
              <span className="flex-1 text-left">Search...</span>
              <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">⌘</span>K
              </kbd>
            </button>
          </div>
        </>
      )}

      {/* Ask Octopus */}
      {collapsed ? (
        <div className="border-b px-2 py-2">
          <SidebarTooltip label={chat.isOpen ? "Close" : "Ask anything"}>
            <button
              onClick={() => { chat.toggle(); onNavigate?.(); }}
              className={cn(
                "flex w-full items-center justify-center rounded-lg border transition-colors",
                "px-2 py-2",
                chat.isOpen
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-primary/25 bg-primary/[0.06] text-primary hover:bg-primary/[0.12]"
              )}
            >
              <IconMessageChatbot className="size-4" />
            </button>
          </SidebarTooltip>
        </div>
      ) : (
        <div className="border-b px-3 py-2">
          <button
            onClick={() => { chat.toggle(); onNavigate?.(); }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
              chat.isOpen
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-primary/25 bg-primary/[0.06] text-foreground hover:bg-primary/[0.12]"
            )}
          >
            <IconMessageChatbot className="size-3.5 shrink-0 text-primary" />
            <span className="flex-1 overflow-hidden text-left">
              {chat.isOpen ? "Ask anything" : <RotatingLabel phrases={ASK_PHRASES} />}
            </span>
            {chat.isOpen ? (
              <span className="size-1.5 rounded-full bg-primary" />
            ) : (
              <IconSparkles className="size-3 shrink-0 text-primary/70" />
            )}
          </button>
        </div>
      )}

      <CommandPalette orgId={currentOrg.id} />

      <nav className={cn("space-y-1 py-4", collapsed ? "px-2" : "px-3")}>
        {collapsed && (
          <SidebarTooltip label="Search (⌘K)">
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
              className="flex w-full items-center justify-center rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50"
            >
              <IconSearch className="size-4" />
            </button>
          </SidebarTooltip>
        )}
        {mainNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          const link = (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
          if (collapsed) {
            return (
              <SidebarTooltip key={href} label={label}>
                {link}
              </SidebarTooltip>
            );
          }
          return link;
        })}

        {(() => {
          const knowledgeActive = pathname === "/knowledge";
          const knowledgeLink = (
            <Link
              href="/knowledge"
              onClick={onNavigate}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                knowledgeActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <IconBook className="size-4 shrink-0" />
              {!collapsed && "Knowledge Center"}
            </Link>
          );
          return collapsed ? (
            <SidebarTooltip label="Knowledge Center">{knowledgeLink}</SidebarTooltip>
          ) : knowledgeLink;
        })()}

      </nav>

      <div className={cn("mt-auto space-y-1 py-2", collapsed ? "px-2" : "px-3")}>
        {bottomNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          const link = (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
          if (collapsed) {
            return (
              <SidebarTooltip key={href} label={label}>
                {link}
              </SidebarTooltip>
            );
          }
          return link;
        })}
      </div>

      <div className={cn("space-y-1 pb-2", collapsed ? "px-2" : "px-3")}>
        {(() => {
          const settingsLink = (
            <Link
              href="/settings"
              onClick={onNavigate}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                collapsed ? "w-full justify-center px-2 py-2" : "gap-3 px-3 py-2",
                pathname.startsWith("/settings")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <IconSettings className="size-4 shrink-0" />
              {!collapsed && "Settings"}
            </Link>
          );
          return collapsed ? (
            <SidebarTooltip label="Settings">{settingsLink}</SidebarTooltip>
          ) : settingsLink;
        })()}
        <HelpMenu collapsed={collapsed} isMobile={!!onNavigate} />
      </div>

      {/* Coupon Banner */}
      <div className={cn("pb-2", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <SidebarTooltip label="Redeem Coupon">
            <button
              onClick={() => setCouponOpen(true)}
              className="flex w-full items-center justify-center rounded-md px-2 py-2 text-emerald-500 transition-colors hover:bg-emerald-500/10"
            >
              <IconTicket className="size-4" />
            </button>
          </SidebarTooltip>
        ) : (
          <button
            type="button"
            onClick={() => setCouponOpen(true)}
            className="group relative block w-full overflow-hidden rounded-lg border border-border/60 bg-sidebar p-3 text-left transition-colors hover:bg-muted"
          >
            <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.07] dark:opacity-[0.12]" aria-hidden="true">
              <filter id="coupon-noise">
                <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
              </filter>
              <rect width="100%" height="100%" filter="url(#coupon-noise)" />
            </svg>
            <IconTicket
              className="pointer-events-none absolute -right-3 -bottom-3 size-20 text-foreground/[0.06] dark:text-foreground/[0.08]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <div className="relative">
              <p className="text-sm font-semibold text-foreground">Have a coupon code?</p>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                Redeem it to unlock free credits on your account.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 rounded-md border border-border/80 bg-background/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors group-hover:bg-background/70">
                Redeem Now
                <span aria-hidden="true">›</span>
              </span>
            </div>
          </button>
        )}
      </div>

      <div className={cn("border-t py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <SidebarTooltip label={user.name}>
            <div>
              <UserMenu name={user.name} email={user.email}>
                <button className="flex w-full items-center justify-center rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent/50">
                  <UserAvatar value={user.email} size={20} />
                </button>
              </UserMenu>
            </div>
          </SidebarTooltip>
        ) : (
          <UserMenu name={user.name} email={user.email}>
            <button className="flex w-full items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-sidebar-accent/50">
              <UserAvatar value={user.email} size={32} />
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {user.email}
                </div>
              </div>
            </button>
          </UserMenu>
        )}
      </div>

      <CouponDialog open={couponOpen} onOpenChange={setCouponOpen} />
    </div>
  );
}

export function AppSidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 border-r transition-all duration-200 md:block",
        collapsed ? "w-14" : "w-64"
      )}
    >
      <SidebarContent
        {...props}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
    </aside>
  );
}

export function MobileHeader(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const chat = useChat();

  return (
    <>
      <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setOpen(true)}
        >
          <IconMenu2 className="size-5" />
        </Button>
        <span className="text-sm font-semibold">Octopus</span>
        <button
          onClick={() => chat.toggle()}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
            chat.isOpen
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-primary/25 bg-primary/[0.06] text-foreground hover:bg-primary/[0.12]"
          )}
        >
          <IconMessageChatbot className="size-4 text-primary" />
          {chat.isOpen ? "Ask anything" : <RotatingLabel phrases={ASK_PHRASES} />}
          {!chat.isOpen && <IconSparkles className="size-3 text-primary/70" />}
        </button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
