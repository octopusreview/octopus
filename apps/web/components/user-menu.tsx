"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { signOut } from "@/lib/auth-client";
import { clearOrgCookie } from "@/app/(app)/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  IconLogout,
  IconUser,
  IconSun,
  IconMoon,
  IconDeviceDesktop,
  IconChevronRight,
  IconCheck,
} from "@tabler/icons-react";

const menuItemClass =
  "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus:bg-muted focus:outline-none";

export function UserMenu({
  name,
  email,
  children,
}: {
  name: string;
  email: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [view, setView] = useState<"main" | "theme">("main");
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setView("main");
      }}
    >
      <DropdownMenuTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="icon" className="rounded-full">
            <IconUser className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-64 overflow-hidden border-border/50 bg-popover p-0 shadow-xl shadow-black/30"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {view === "main" ? (
          <>
            {/* User info */}
            <div className="border-b border-border/50 px-4 py-3">
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">{email}</div>
            </div>

            {/* Menu items */}
            <div className="p-1">
              <button
                onClick={() => setView("theme")}
                className={menuItemClass}
              >
                {theme === "dark" ? (
                  <IconMoon className="size-4 text-muted-foreground" />
                ) : theme === "light" ? (
                  <IconSun className="size-4 text-muted-foreground" />
                ) : (
                  <IconDeviceDesktop className="size-4 text-muted-foreground" />
                )}
                <span className="flex-1">Theme</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {theme ?? "system"}
                </span>
                <IconChevronRight className="size-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Sign out */}
            <div className="border-t border-border/50 p-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setConfirmOpen(true);
                }}
                className={menuItemClass}
              >
                <IconLogout className="size-4 text-muted-foreground" />
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Theme picker sub-view */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
              <button
                onClick={() => setView("main")}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted"
              >
                <IconChevronRight className="size-3.5 rotate-180 text-muted-foreground" />
              </button>
              <span className="text-sm font-medium">Theme</span>
            </div>
            <div className="p-1">
              {(
                [
                  { key: "light", label: "Light", icon: IconSun },
                  { key: "dark", label: "Dark", icon: IconMoon },
                  { key: "system", label: "System", icon: IconDeviceDesktop },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setTheme(key);
                    setView("main");
                  }}
                  className={menuItemClass}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                  {theme === key && (
                    <IconCheck className="size-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign out</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to sign out?
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              try {
                setConfirmOpen(false);
                await clearOrgCookie();
                await signOut();
                router.push("/login");
                router.refresh();
              } catch (err) {
                console.error("Sign-out failed", err);
                toast.error("Sign-out failed. Please try again.");
              }
            }}
          >
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
