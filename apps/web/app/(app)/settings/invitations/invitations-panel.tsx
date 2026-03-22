"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { InviteModal } from "./invite-modal";

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
}

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  accepted: { label: "Accepted", variant: "default" },
  expired: { label: "Expired", variant: "secondary" },
  revoked: { label: "Revoked", variant: "destructive" },
};

const ROLE_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  owner: { label: "Owner", variant: "default" },
  admin: { label: "Admin", variant: "secondary" },
  member: { label: "Member", variant: "outline" },
};

interface InvitationsPanelProps {
  orgId: string;
  isAdmin: boolean;
}

export function InvitationsPanel({ orgId, isAdmin }: InvitationsPanelProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [callerRole, setCallerRole] = useState<string>("member");
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [roleChanging, setRoleChanging] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`);
      if (!res.ok) return;
      const data = await res.json();
      setMembers(data.members);
      setCallerRole(data.callerRole);
      setCallerUserId(data.callerUserId);
    } finally {
      setMembersLoading(false);
    }
  }, [orgId]);

  const fetchInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orgs/${orgId}/invitations?status=pending`);
      if (!res.ok) {
        console.error("Failed to fetch invitations:", res.status);
        return;
      }
      const data = await res.json();
      setInvitations(data.invitations);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  async function handleRevoke() {
    if (!revokeTarget || actionLoading === revokeTarget.id) return;
    setActionLoading(revokeTarget.id);
    try {
      await fetch(`/api/orgs/${orgId}/invitations/${revokeTarget.id}`, { method: "DELETE" });
      await fetchInvitations();
    } finally {
      setActionLoading(null);
      setRevokeTarget(null);
    }
  }

  async function handleResend(inv: Invitation) {
    if (actionLoading === inv.id) return;
    setActionLoading(inv.id);
    try {
      await fetch(`/api/orgs/${orgId}/invitations/${inv.id}/resend`, { method: "POST" });
      await fetchInvitations();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    setRoleChanging(memberId);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error("Role change failed:", data.error);
        return;
      }
      await fetchMembers();
    } finally {
      setRoleChanging(null);
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    setActionLoading(removeTarget.id);
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${removeTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to remove member");
        return;
      }
      await fetchMembers();
    } finally {
      setActionLoading(null);
      setRemoveTarget(null);
    }
  }

  function canRemoveMember(target: Member): boolean {
    if (!isAdmin) return false;
    if (target.user.id === callerUserId) return false;
    if (target.role === "owner") return false;
    if (callerRole !== "owner" && target.role === "admin") return false;
    return true;
  }

  function canChangeRole(target: Member): boolean {
    if (!isAdmin) return false;
    if (target.role === "owner") return false;
    // Only owner can manage admin roles
    if (callerRole !== "owner" && target.role === "admin") return false;
    return true;
  }

  function getAvailableRoles(target: Member): string[] {
    if (callerRole === "owner") return ["admin", "member"];
    // Admin can only toggle member role (not admin)
    if (target.role === "member") return ["admin", "member"];
    return [];
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getInitials(name: string | null, email: string): string {
    if (name) {
      return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    }
    return email[0].toUpperCase();
  }

  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending" || inv.status === "expired",
  );

  function renderMemberRow(m: Member) {
    const badge = ROLE_BADGES[m.role] ?? ROLE_BADGES.member;
    const changeable = canChangeRole(m);
    const isBusy = roleChanging === m.id;

    return (
      <div
        key={m.id}
        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3 min-w-0">
          {m.user.image ? (
            <img src={m.user.image} alt="" className="size-8 rounded-full" />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {getInitials(m.user.name, m.user.email)}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {m.user.name || m.user.email}
              </span>
              {!changeable && (
                <Badge variant={badge.variant}>{badge.label}</Badge>
              )}
            </div>
            {m.user.name && (
              <p className="text-muted-foreground text-xs truncate">{m.user.email}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {changeable && (
            <Select
              value={m.role}
              onValueChange={(val) => handleRoleChange(m.id, val)}
              disabled={isBusy}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getAvailableRoles(m).map((role) => (
                  <SelectItem key={role} value={role} className="text-xs capitalize">
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canRemoveMember(m) && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={() => setRemoveTarget(m)}
              disabled={isBusy}
            >
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  function renderInvitationRow(inv: Invitation) {
    const badge = STATUS_BADGES[inv.status] ?? STATUS_BADGES.pending;
    const busy = actionLoading === inv.id;

    return (
      <div
        key={inv.id}
        className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{inv.email}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Badge variant="outline" className="capitalize">{inv.role}</Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            Sent {formatDate(inv.createdAt)} · Expires {formatDate(inv.expiresAt)}
          </p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => handleResend(inv)}
            >
              Resend
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => setRevokeTarget(inv)}
            >
              Revoke
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Active members and their roles.</CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="text-muted-foreground py-6 text-center text-sm">Loading...</div>
          ) : members.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No members found.
            </div>
          ) : (
            <div className="divide-border divide-y rounded-md border">
              {members.map(renderMemberRow)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invitations */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>Invitations waiting to be accepted.</CardDescription>
          {isAdmin && (
            <CardAction>
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                Invite
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground py-6 text-center text-sm">Loading...</div>
          ) : pendingInvitations.length === 0 ? (
            <div className="text-muted-foreground py-6 text-center text-sm">
              No pending invitations.
            </div>
          ) : (
            <div className="divide-border divide-y rounded-md border">
              {pendingInvitations.map(renderInvitationRow)}
            </div>
          )}
        </CardContent>
      </Card>

      <InviteModal
        orgId={orgId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={fetchInvitations}
      />

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {revokeTarget?.status === "accepted" ? "Remove Member" : "Revoke Invitation"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.status === "accepted"
                ? <>Are you sure you want to remove <strong>{revokeTarget?.email}</strong> from the organization?</>
                : <>Are you sure you want to revoke the invitation for <strong>{revokeTarget?.email}</strong>?</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke}>
              {revokeTarget?.status === "accepted" ? "Remove" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{removeTarget?.user.name || removeTarget?.user.email}</strong> from the organization? They will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
