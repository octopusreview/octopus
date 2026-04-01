"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
} from "@tabler/icons-react";
import { CommandPalette } from "@/components/command-palette";

const mainNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: IconGitBranch },
  { href: "/issues", label: "Issues", icon: IconBug },
  { href: "/timeline", label: "Timeline", icon: IconTimeline },
];

const bottomNavItems = [
  { href: "/usage", label: "Usage", icon: IconChartBar },
];

type Org = { id: string; name: string };

type SidebarProps = {
  user: { name: string; email: string };
  orgs: Org[];
  currentOrg: Org;
  isAdmin?: boolean;
};

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

function SidebarContent({
  user,
  orgs,
  currentOrg,
  isAdmin,
  collapsed,
  onToggleCollapse,
  onNavigate,
}: SidebarProps & { collapsed?: boolean; onToggleCollapse?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const chat = useChat();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {collapsed ? (
        <div className="flex items-center justify-center border-b py-3">
          <SidebarTooltip label={currentOrg.name}>
            <div>
              <OrgSwitcher orgs={orgs} currentOrg={currentOrg} collapsed />
            </div>
          </SidebarTooltip>
        </div>
      ) : (
        <>
          <div className="border-b px-3 py-3">
            <OrgSwitcher orgs={orgs} currentOrg={currentOrg} />
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
          <SidebarTooltip label={chat.isOpen ? "Close Ask Octopus" : "Ask Octopus"}>
            <button
              onClick={() => { chat.toggle(); onNavigate?.(); }}
              className={cn(
                "flex w-full items-center justify-center rounded-md px-2 py-2 transition-colors",
                chat.isOpen
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
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
              "flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
              chat.isOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
            )}
          >
            <IconMessageChatbot className="size-3.5" />
            <span className="flex-1 text-left">Ask Octopus</span>
            {chat.isOpen && (
              <span className="size-1.5 rounded-full bg-primary" />
            )}
          </button>
        </div>
      )}

      <CommandPalette orgId={currentOrg.id} />

      <nav className={cn("flex-1 space-y-1 py-4", collapsed ? "px-2" : "px-3")}>
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

      <div className={cn("space-y-1 py-2", collapsed ? "px-2" : "px-3")}>
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

      <div className={cn("pb-2", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <div className="flex flex-col gap-1">
            <SidebarTooltip label="Settings">
              <Link
                href="/settings"
                onClick={onNavigate}
                className={cn(
                  "flex w-full items-center justify-center rounded-md px-2 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith("/settings")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <IconSettings className="size-4 shrink-0" />
              </Link>
            </SidebarTooltip>
            {onToggleCollapse && (
              <SidebarTooltip label="Expand sidebar">
                <button
                  onClick={onToggleCollapse}
                  className="flex w-full items-center justify-center rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  <IconLayoutSidebarLeftExpand className="size-4" />
                </button>
              </SidebarTooltip>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Link
              href="/settings"
              onClick={onNavigate}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <IconSettings className="size-4 shrink-0" />
              Settings
            </Link>
            {onToggleCollapse && (
              <SidebarTooltip label="Collapse sidebar">
                <button
                  onClick={onToggleCollapse}
                  className="flex items-center rounded-md px-2 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
                >
                  <IconLayoutSidebarLeftCollapse className="size-4" />
                </button>
              </SidebarTooltip>
            )}
          </div>
        )}
      </div>
      <div className={cn("border-t py-3", collapsed ? "px-2" : "px-3")}>
        {collapsed ? (
          <SidebarTooltip label={user.name}>
            <div>
              <UserMenu name={user.name} email={user.email} isAdmin={isAdmin}>
                <button className="flex w-full items-center justify-center rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent/50">
                  <UserAvatar value={user.email} size={20} />
                </button>
              </UserMenu>
            </div>
          </SidebarTooltip>
        ) : (
          <UserMenu name={user.name} email={user.email} isAdmin={isAdmin}>
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
            "ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            chat.isOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <IconMessageChatbot className="size-4" />
          Ask Octopus
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
