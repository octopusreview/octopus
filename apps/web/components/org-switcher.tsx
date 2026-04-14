"use client";

import { useActionState, useState, useMemo, useRef, useEffect } from "react";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconSelector, IconCheck, IconPlus, IconBuildingSkyscraper, IconMail } from "@tabler/icons-react";
import { switchOrganization, createOrganization } from "@/app/(app)/actions";
import { MAX_OWNED_ORGS_PER_USER } from "@/lib/org-limits";
import Link from "next/link";

type Org = {
  id: string;
  name: string;
};

function getOrgInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

const avatarColors = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-pink-600",
  "bg-indigo-600",
];

function getOrgColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return avatarColors[((hash % avatarColors.length) + avatarColors.length) % avatarColors.length];
}

export function OrgSwitcher({
  orgs,
  currentOrg,
  collapsed,
  canCreateOrg = true,
}: {
  orgs: Org[];
  currentOrg: Org;
  collapsed?: boolean;
  canCreateOrg?: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enterpriseDialogOpen, setEnterpriseDialogOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [state, formAction, pending] = useActionState(createOrganization, {});
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dropdownOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [dropdownOpen]);

  const filtered = useMemo(
    () =>
      search.trim()
        ? orgs.filter((o) =>
            o.name.toLowerCase().includes(search.toLowerCase()),
          )
        : orgs,
    [orgs, search],
  );

  return (
    <>
      <DropdownMenu
        open={dropdownOpen}
        onOpenChange={(open) => {
          setDropdownOpen(open);
          if (!open) setSearch("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            className={
              collapsed
                ? "flex items-center justify-center rounded-md transition-colors hover:opacity-80"
                : "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/50"
            }
          >
            {collapsed ? (
              <Image src="/logo.svg" alt="Octopus" width={20} height={20} />
            ) : (
              <>
                <Link href="/dashboard" onClick={(e) => e.stopPropagation()}>
                  <Image src="/logo.svg" alt="Octopus" width={24} height={24} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">Octopus</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {currentOrg.name}
                  </div>
                </div>
                <IconSelector className="size-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={8}
          className="w-72 overflow-hidden border-border/50 bg-popover p-0 shadow-xl shadow-black/30"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Search */}
          <div className="flex items-center border-b border-border/50 px-3">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Find Organization..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="ml-2 shrink-0 rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Esc
            </kbd>
          </div>

          {/* Org list */}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                No organizations found
              </div>
            ) : (
              filtered.map((org) => (
                <button
                  key={org.id}
                  onClick={() => {
                    if (org.id !== currentOrg.id) {
                      switchOrganization(org.id);
                    }
                    setDropdownOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
                >
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${getOrgColor(org.id)}`}
                  >
                    {getOrgInitials(org.name)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {org.name}
                  </span>
                  {org.id === currentOrg.id && (
                    <IconCheck className="size-4 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Create org */}
          <div className="border-t border-border/50 p-1">
            <button
              onClick={() => {
                setDropdownOpen(false);
                if (canCreateOrg) {
                  setDialogOpen(true);
                } else {
                  setEnterpriseDialogOpen(true);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                <IconPlus className="size-4" />
              </div>
              <div>
                <div className="text-sm font-medium">Create Organization</div>
                <div className="text-xs text-muted-foreground">
                  Collaborate with your team
                </div>
              </div>
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>
          <form action={formAction}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  name="name"
                  placeholder="My Organization"
                  required
                  minLength={2}
                />
              </div>
              {state.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={enterpriseDialogOpen} onOpenChange={setEnterpriseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Need more organizations?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <IconBuildingSkyscraper className="size-6 text-primary" />
              </div>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              You&apos;ve reached the maximum of {MAX_OWNED_ORGS_PER_USER} organizations on the free plan.
              Contact us for an Enterprise plan with unlimited organizations and
              dedicated support.
            </p>
            <div className="flex items-center justify-center gap-2 rounded-md border border-border/50 bg-muted/50 px-3 py-2 text-sm">
              <IconMail className="size-4 text-muted-foreground" />
              <a
                href="mailto:enterprise@octopus-review.ai"
                className="font-medium text-primary hover:underline"
              >
                enterprise@octopus-review.ai
              </a>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEnterpriseDialogOpen(false)}
            >
              Close
            </Button>
            <Button asChild>
              <a href="mailto:enterprise@octopus-review.ai">Contact Sales</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
