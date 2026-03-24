"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { IconCheck, IconX, IconPlus, IconTrash, IconDatabaseImport, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { approveRequest, rejectRequest, addSafePackage, removeSafePackage, seedPopularPackages } from "./actions";

interface SafePackageItem {
  id: string;
  name: string;
  weeklyDownloads: number;
  reason: string | null;
  createdAt: string;
}

interface PendingRequestItem {
  id: string;
  name: string;
  version: string | null;
  reason: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  orgName: string;
}

interface Props {
  safePackages: SafePackageItem[];
  pendingRequests: PendingRequestItem[];
}

export function SafePackagesAdmin({ safePackages, pendingRequests }: Props) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newReason, setNewReason] = useState("");
  const [search, setSearch] = useState("");

  const filteredPackages = search
    ? safePackages.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : safePackages;

  const handleAdd = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      await addSafePackage(newName.trim(), newReason.trim() || "Manually added by admin");
      setNewName("");
      setNewReason("");
    });
  };

  const handleSeed = () => {
    startTransition(async () => {
      const result = await seedPopularPackages();
      if (result.success) {
        toast.success(`Seeded ${result.added} popular packages into the safe list`);
      } else {
        toast.error(result.error ?? "Failed to seed packages");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pending Requests
              <Badge variant="secondary">{pendingRequests.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRequests.map((req) => (
              <div key={req.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-semibold">{req.name}</code>
                    {req.version && <span className="text-muted-foreground text-xs">@{req.version}</span>}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {req.reason}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    by {req.userName} ({req.orgName}) — {new Date(req.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => startTransition(async () => { await approveRequest(req.id); })}
                  >
                    <IconCheck className="mr-1 h-3 w-3" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => startTransition(async () => { await rejectRequest(req.id); })}
                  >
                    <IconX className="mr-1 h-3 w-3" />
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add Package + Seed */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Safe Packages ({safePackages.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={handleSeed} disabled={isPending}>
              {isPending ? <IconLoader2 className="mr-1 h-3 w-3 animate-spin" /> : <IconDatabaseImport className="mr-1 h-3 w-3" />}
              Seed Popular Packages
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add form */}
          <div className="flex gap-2">
            <Input
              placeholder="Package name (e.g. lodash)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Reason (optional)"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleAdd} disabled={!newName.trim() || isPending}>
              <IconPlus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>

          {/* Search */}
          <Input
            placeholder="Search packages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {/* Package list */}
          <div className="max-h-96 overflow-y-auto space-y-1">
            {filteredPackages.map((pkg) => (
              <div key={pkg.id} className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <code className="font-medium">{pkg.name}</code>
                  {pkg.weeklyDownloads > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {pkg.weeklyDownloads >= 1_000_000
                        ? `${(pkg.weeklyDownloads / 1_000_000).toFixed(1)}M`
                        : pkg.weeklyDownloads >= 1_000
                          ? `${(pkg.weeklyDownloads / 1_000).toFixed(0)}K`
                          : pkg.weeklyDownloads}/week
                    </span>
                  )}
                  {pkg.reason && (
                    <span className="text-muted-foreground text-xs truncate max-w-64">{pkg.reason}</span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  onClick={() => startTransition(async () => { await removeSafePackage(pkg.id); })}
                >
                  <IconTrash className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
