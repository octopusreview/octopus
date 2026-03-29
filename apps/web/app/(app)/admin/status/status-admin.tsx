"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  IconPlus,
  IconTrash,
  IconKey,
  IconCopy,
  IconCheck,
  IconApi,
  IconChevronDown,
  IconChevronRight,
  IconPencil,
  IconSparkles,
} from "@tabler/icons-react";
import {
  createComponent,
  updateComponent,
  updateComponentStatus,
  deleteComponent,
  createIncident,
  addIncidentUpdate,
  deleteIncident,
  generateIncidentMessage,
  generateStatusApiToken,
  deleteStatusApiToken,
} from "./actions";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────────────────

interface ComponentItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  isVisible: boolean;
}

interface IncidentUpdateItem {
  id: string;
  status: string;
  message: string;
  createdByName: string | null;
  createdAt: string;
}

interface IncidentItem {
  id: string;
  title: string;
  severity: string;
  status: string;
  message: string;
  componentId: string | null;
  componentName: string | null;
  resolvedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updates: IncidentUpdateItem[];
}

interface TokenItem {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const COMPONENT_STATUSES = [
  { value: "operational", label: "Operational", color: "bg-green-500" },
  { value: "degraded", label: "Degraded", color: "bg-yellow-500" },
  { value: "partial_outage", label: "Partial Outage", color: "bg-orange-500" },
  { value: "major_outage", label: "Major Outage", color: "bg-red-500" },
  { value: "maintenance", label: "Maintenance", color: "bg-blue-500" },
];

const SEVERITIES = [
  { value: "critical", label: "Critical", variant: "destructive" as const },
  { value: "major", label: "Major", variant: "default" as const },
  { value: "minor", label: "Minor", variant: "secondary" as const },
  { value: "maintenance", label: "Maintenance", variant: "outline" as const },
];

const INCIDENT_STATUSES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];

function statusDot(status: string) {
  const s = COMPONENT_STATUSES.find((cs) => cs.value === status);
  return (
    <span
      className={`inline-block size-2.5 rounded-full ${s?.color ?? "bg-gray-400"}`}
    />
  );
}

function severityBadge(severity: string) {
  const s = SEVERITIES.find((sv) => sv.value === severity);
  return <Badge variant={s?.variant ?? "secondary"}>{s?.label ?? severity}</Badge>;
}

function statusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CopyBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="rounded bg-muted px-4 py-3 pr-12 text-sm font-mono overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute right-2 top-2 rounded border border-border bg-background p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {copied ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconCopy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function StatusAdmin({
  components,
  incidents,
  tokens,
}: {
  components: ComponentItem[];
  incidents: IncidentItem[];
  tokens: TokenItem[];
}) {
  const [isPending, startTransition] = useTransition();

  // Component form state
  const [showComponentForm, setShowComponentForm] = useState(false);
  const [editingComponent, setEditingComponent] = useState<string | null>(null);
  const [compName, setCompName] = useState("");
  const [compDesc, setCompDesc] = useState("");
  const [compOrder, setCompOrder] = useState("0");

  // Incident form state
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incTitle, setIncTitle] = useState("");
  const [incSeverity, setIncSeverity] = useState("minor");
  const [incMessage, setIncMessage] = useState("");
  const [incComponentId, setIncComponentId] = useState("");

  // Incident update state
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState("investigating");
  const [updateMessage, setUpdateMessage] = useState("");

  // Token state
  const [tokenName, setTokenName] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [showApiDocs, setShowApiDocs] = useState(false);

  // ── Component Handlers ──────────────────────────────────────────────────

  function handleCreateComponent() {
    const fd = new FormData();
    fd.set("name", compName);
    fd.set("description", compDesc);
    fd.set("sortOrder", compOrder);
    startTransition(async () => {
      const result = await createComponent(fd);
      if ("error" in result) toast.error(String(result.error));
      else {
        toast.success("Component created");
        setCompName("");
        setCompDesc("");
        setCompOrder("0");
        setShowComponentForm(false);
      }
    });
  }

  function handleUpdateComponent(id: string) {
    const fd = new FormData();
    fd.set("name", compName);
    fd.set("description", compDesc);
    fd.set("sortOrder", compOrder);
    fd.set("isVisible", "true");
    startTransition(async () => {
      const result = await updateComponent(id, fd);
      if ("error" in result) toast.error(String(result.error));
      else {
        toast.success("Component updated");
        setEditingComponent(null);
        setCompName("");
        setCompDesc("");
        setCompOrder("0");
      }
    });
  }

  function handleComponentStatusChange(id: string, status: string) {
    startTransition(async () => {
      const result = await updateComponentStatus(id, status);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Status updated");
    });
  }

  function handleDeleteComponent(id: string) {
    if (!confirm("Are you sure you want to delete this component?")) return;
    startTransition(async () => {
      const result = await deleteComponent(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Component deleted");
    });
  }

  function startEditComponent(comp: ComponentItem) {
    setEditingComponent(comp.id);
    setCompName(comp.name);
    setCompDesc(comp.description ?? "");
    setCompOrder(String(comp.sortOrder));
  }

  // ── Incident Handlers ───────────────────────────────────────────────────

  function handleGenerateMessage() {
    if (!incMessage.trim()) {
      toast.error("Write a brief summary first, then generate");
      return;
    }
    const compName =
      components.find((c) => c.id === incComponentId)?.name ?? null;
    startTransition(async () => {
      const result = await generateIncidentMessage(
        incMessage.trim(),
        incSeverity,
        compName,
      );
      if ("error" in result) toast.error(String(result.error));
      else {
        if (result.title) setIncTitle(result.title);
        setIncMessage(result.message!);
      }
    });
  }

  function handleCreateIncident() {
    const fd = new FormData();
    fd.set("title", incTitle);
    fd.set("severity", incSeverity);
    fd.set("message", incMessage);
    if (incComponentId) fd.set("componentId", incComponentId);
    startTransition(async () => {
      const result = await createIncident(fd);
      if ("error" in result) toast.error(String(result.error));
      else {
        toast.success("Incident created");
        setIncTitle("");
        setIncSeverity("minor");
        setIncMessage("");
        setIncComponentId("");
        setShowIncidentForm(false);
      }
    });
  }

  function handleGenerateUpdateMessage(inc: IncidentItem) {
    if (!updateMessage.trim()) {
      toast.error("Write a brief summary first, then generate");
      return;
    }
    startTransition(async () => {
      const result = await generateIncidentMessage(
        updateMessage.trim(),
        inc.severity,
        inc.componentName,
      );
      if ("error" in result) toast.error(String(result.error));
      else {
        setUpdateMessage(result.message!);
      }
    });
  }

  function handleAddUpdate(incidentId: string) {
    const fd = new FormData();
    fd.set("status", updateStatus);
    fd.set("message", updateMessage);
    startTransition(async () => {
      const result = await addIncidentUpdate(incidentId, fd);
      if ("error" in result) toast.error(String(result.error));
      else {
        toast.success("Update added");
        setUpdateMessage("");
        setUpdateStatus("investigating");
      }
    });
  }

  function handleDeleteIncident(id: string) {
    if (!confirm("Are you sure you want to delete this incident?")) return;
    startTransition(async () => {
      const result = await deleteIncident(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Incident deleted");
    });
  }

  // ── Token Handlers ──────────────────────────────────────────────────────

  function handleGenerateToken() {
    if (!tokenName.trim()) return;
    startTransition(async () => {
      const result = await generateStatusApiToken(tokenName.trim());
      if ("error" in result) {
        toast.error(String(result.error));
      } else {
        setRevealedToken(result.token!);
        setTokenName("");
        toast.success("Token generated. Copy it now, it won't be shown again.");
      }
    });
  }

  function handleDeleteToken(id: string) {
    if (!confirm("Are you sure you want to revoke this token?")) return;
    startTransition(async () => {
      const result = await deleteStatusApiToken(id);
      if ("error" in result) toast.error(String(result.error));
      else toast.success("Token revoked");
    });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      {/* ── Components Section ────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">System Components</h1>
          <Button onClick={() => setShowComponentForm(!showComponentForm)}>
            <IconPlus className="mr-2 size-4" />
            Add Component
          </Button>
        </div>

        {showComponentForm && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                placeholder="Component name"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
              />
              <Input
                placeholder="Description (optional)"
                value={compDesc}
                onChange={(e) => setCompDesc(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Sort order"
                value={compOrder}
                onChange={(e) => setCompOrder(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={isPending || !compName.trim()}
                onClick={handleCreateComponent}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowComponentForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {components.length === 0 ? (
          <p className="text-muted-foreground">
            No components yet. Add your first system component.
          </p>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Component</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {components.map((comp) => (
                  <tr key={comp.id} className="border-b last:border-0">
                    {editingComponent === comp.id ? (
                      <td colSpan={4} className="px-4 py-3">
                        <div className="flex flex-col gap-3">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Input
                              value={compName}
                              onChange={(e) => setCompName(e.target.value)}
                              placeholder="Name"
                            />
                            <Input
                              value={compDesc}
                              onChange={(e) => setCompDesc(e.target.value)}
                              placeholder="Description"
                            />
                            <Input
                              type="number"
                              value={compOrder}
                              onChange={(e) => setCompOrder(e.target.value)}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={isPending}
                              onClick={() => handleUpdateComponent(comp.id)}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingComponent(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-medium">{comp.name}</span>
                            {comp.description && (
                              <p className="text-sm text-muted-foreground">
                                {comp.description}
                              </p>
                            )}
                            {!comp.isVisible && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                Hidden
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="rounded border bg-background px-2 py-1 text-sm"
                            value={comp.status}
                            onChange={(e) =>
                              handleComponentStatusChange(comp.id, e.target.value)
                            }
                            disabled={isPending}
                          >
                            {COMPONENT_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {comp.sortOrder}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditComponent(comp)}
                            >
                              <IconPencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isPending}
                              onClick={() => handleDeleteComponent(comp.id)}
                            >
                              <IconTrash className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Incidents Section ─────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Incidents</h2>
          <Button onClick={() => setShowIncidentForm(!showIncidentForm)}>
            <IconPlus className="mr-2 size-4" />
            New Incident
          </Button>
        </div>

        {showIncidentForm && (
          <div className="rounded-lg border p-4 space-y-3">
            <Input
              placeholder="Incident title"
              value={incTitle}
              onChange={(e) => setIncTitle(e.target.value)}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <select
                className="rounded border bg-background px-3 py-2 text-sm"
                value={incSeverity}
                onChange={(e) => setIncSeverity(e.target.value)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                className="rounded border bg-background px-3 py-2 text-sm"
                value={incComponentId}
                onChange={(e) => setIncComponentId(e.target.value)}
              >
                <option value="">No component</option>
                {components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <textarea
                className="w-full rounded border bg-background px-3 py-2 text-sm"
                rows={3}
                placeholder="Write a brief summary (any language), then click Enhance with AI for a polished English message..."
                value={incMessage}
                onChange={(e) => setIncMessage(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isPending || !incMessage.trim()}
                onClick={handleGenerateMessage}
              >
                <IconSparkles className="mr-1.5 size-4" />
                Enhance with AI
              </Button>
              <Button
                disabled={
                  isPending ||
                  !incTitle.trim() ||
                  !incMessage.trim()
                }
                onClick={handleCreateIncident}
              >
                Create Incident
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowIncidentForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {incidents.length === 0 ? (
          <p className="text-muted-foreground">No incidents.</p>
        ) : (
          <div className="space-y-3">
            {incidents.map((inc) => (
              <div key={inc.id} className="rounded-lg border">
                <div
                  className="flex cursor-pointer items-center gap-3 px-4 py-3"
                  onClick={() =>
                    setExpandedIncident(
                      expandedIncident === inc.id ? null : inc.id,
                    )
                  }
                >
                  {expandedIncident === inc.id ? (
                    <IconChevronDown className="size-4 shrink-0" />
                  ) : (
                    <IconChevronRight className="size-4 shrink-0" />
                  )}
                  <div className="flex flex-1 items-center gap-2">
                    {statusDot(
                      inc.status === "resolved"
                        ? "operational"
                        : inc.severity === "critical"
                          ? "major_outage"
                          : inc.severity === "major"
                            ? "partial_outage"
                            : inc.severity === "maintenance"
                              ? "maintenance"
                              : "degraded",
                    )}
                    <span className="font-medium">{inc.title}</span>
                    {severityBadge(inc.severity)}
                    <Badge variant="outline">{statusLabel(inc.status)}</Badge>
                    {inc.componentName && (
                      <span className="text-sm text-muted-foreground">
                        {inc.componentName}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {new Date(inc.createdAt).toLocaleDateString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteIncident(inc.id);
                    }}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>

                {expandedIncident === inc.id && (
                  <div className="border-t px-4 py-4 space-y-4">
                    {/* Initial message */}
                    <div className="rounded bg-muted/50 p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          Investigating
                        </Badge>
                        <span>{inc.createdByName ?? "API"}</span>
                        <span>
                          {new Date(inc.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{inc.message}</p>
                    </div>

                    {/* Timeline updates */}
                    {inc.updates.map((upd) => (
                      <div
                        key={upd.id}
                        className="rounded bg-muted/50 p-3 text-sm"
                      >
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {statusLabel(upd.status)}
                          </Badge>
                          <span>{upd.createdByName ?? "API"}</span>
                          <span>
                            {new Date(upd.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{upd.message}</p>
                      </div>
                    ))}

                    {/* Add update form */}
                    {inc.status !== "resolved" && (
                      <div className="space-y-2 border-t pt-3">
                        <div className="flex gap-2">
                          <select
                            className="rounded border bg-background px-2 py-1 text-sm"
                            value={updateStatus}
                            onChange={(e) => setUpdateStatus(e.target.value)}
                          >
                            {INCIDENT_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {statusLabel(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          className="w-full rounded border bg-background px-3 py-2 text-sm"
                          rows={2}
                          placeholder="Write a brief summary, then generate with AI..."
                          value={updateMessage}
                          onChange={(e) => setUpdateMessage(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={isPending || !updateMessage.trim()}
                            onClick={() => handleAddUpdate(inc.id)}
                          >
                            Add Update
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending || !updateMessage.trim()}
                            onClick={() => handleGenerateUpdateMessage(inc)}
                          >
                            <IconSparkles className="mr-1.5 size-3.5" />
                            Enhance with AI
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── API Tokens Section ────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <IconKey className="size-5" />
            API Tokens
          </h2>
          <Button variant="outline" onClick={() => setShowApiDocs(!showApiDocs)}>
            <IconApi className="mr-2 size-4" />
            {showApiDocs ? "Hide" : "Show"} API Docs
          </Button>
        </div>

        {/* Generate Token */}
        <div className="flex items-center gap-3">
          <Input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g. monitoring-agent)"
            className="max-w-xs"
            onKeyDown={(e) => e.key === "Enter" && handleGenerateToken()}
          />
          <Button
            disabled={isPending || !tokenName.trim()}
            onClick={handleGenerateToken}
          >
            <IconPlus className="mr-2 size-4" />
            Generate Token
          </Button>
        </div>

        {/* Revealed Token */}
        {revealedToken && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
            <p className="mb-2 text-sm font-medium text-yellow-500">
              Copy this token now. It won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                {revealedToken}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(revealedToken)}
              >
                <IconCopy className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Token List */}
        {tokens.length > 0 && (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                      {t.tokenPrefix}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {t.lastUsedAt
                        ? new Date(t.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isPending}
                        onClick={() => handleDeleteToken(t.id)}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* API Documentation */}
        {showApiDocs && (
          <div className="rounded-lg border bg-muted/30 p-6 space-y-6">
            <h3 className="text-lg font-bold">Status API Documentation</h3>

            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Authentication</h4>
                <code className="block rounded bg-muted px-3 py-2 text-sm font-mono">
                  Authorization: Bearer status_xxxxxxxxxxxxx
                </code>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Endpoints</h4>
                <div className="space-y-1">
                  <div className="rounded bg-muted px-3 py-2 text-sm font-mono">
                    GET /api/status — Public status (no auth)
                  </div>
                  <div className="rounded bg-muted px-3 py-2 text-sm font-mono">
                    POST /api/status/incidents — Create incident
                  </div>
                  <div className="rounded bg-muted px-3 py-2 text-sm font-mono">
                    PATCH /api/status/incidents/[id] — Update incident
                  </div>
                  <div className="rounded bg-muted px-3 py-2 text-sm font-mono">
                    PATCH /api/status/components/[id] — Update component status
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">
                  Create Incident (curl)
                </h4>
                <CopyBlock>{`curl -X POST https://octopus-review.ai/api/status/incidents \\
  -H "Authorization: Bearer status_xxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "RAG degraded performance",
    "severity": "minor",
    "message": "Automated detection: RAG response times elevated",
    "componentId": "component-id-here"
  }'`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">
                  Update Incident (curl)
                </h4>
                <CopyBlock>{`curl -X PATCH https://octopus-review.ai/api/status/incidents/INCIDENT_ID \\
  -H "Authorization: Bearer status_xxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "resolved",
    "message": "Performance restored to normal levels"
  }'`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">
                  Update Component Status (curl)
                </h4>
                <CopyBlock>{`curl -X PATCH https://octopus-review.ai/api/status/components/COMPONENT_ID \\
  -H "Authorization: Bearer status_xxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "degraded" }'`}</CopyBlock>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Severity Levels</h4>
                <div className="rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left">
                        <th className="px-3 py-2 font-medium">Severity</th>
                        <th className="px-3 py-2 font-medium">
                          Auto Component Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="px-3 py-2">critical</td>
                        <td className="px-3 py-2">major_outage</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-3 py-2">major</td>
                        <td className="px-3 py-2">partial_outage</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-3 py-2">minor</td>
                        <td className="px-3 py-2">degraded</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2">maintenance</td>
                        <td className="px-3 py-2">maintenance</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
