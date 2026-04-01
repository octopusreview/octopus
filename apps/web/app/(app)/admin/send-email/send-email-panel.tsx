"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  IconSend,
  IconUsers,
  IconCheck,
  IconAlertTriangle,
  IconLoader2,
} from "@tabler/icons-react";

interface Template {
  slug: string;
  name: string;
  category: string;
  subject: string;
}

interface Recipient {
  id: string;
  email: string;
  name: string;
}

const AUDIENCE_FILTERS = [
  { key: "all", label: "All users", description: "Everyone except banned" },
  {
    key: "inactive-7",
    label: "Inactive 7+ days",
    description: "Haven't logged in for 7 days",
  },
  {
    key: "inactive-15",
    label: "Inactive 15+ days",
    description: "Haven't logged in for 15 days",
  },
  {
    key: "inactive-30",
    label: "Inactive 30+ days",
    description: "Haven't logged in for 30 days",
  },
  {
    key: "new-7",
    label: "New users (7 days)",
    description: "Registered in the last 7 days",
  },
  {
    key: "new-15",
    label: "New users (15 days)",
    description: "Registered in the last 15 days",
  },
  {
    key: "new-30",
    label: "New users (30 days)",
    description: "Registered in the last 30 days",
  },
  {
    key: "no-repo",
    label: "No repositories",
    description: "Users whose orgs have no connected repos",
  },
  {
    key: "no-review",
    label: "No reviews yet",
    description: "Users whose orgs haven't had any PR reviews",
  },
  {
    key: "marketing-opted-in",
    label: "Marketing opted in",
    description: "Users who accept marketing emails",
  },
];

export function SendEmailPanel({
  templates,
}: {
  templates: Template[];
}) {
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [audience, setAudience] = useState("all");
  const [cooldownDays, setCooldownDays] = useState(30);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  async function handlePreviewAudience() {
    setLoading(true);
    setRecipients(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ audience, cooldownDays: String(cooldownDays) });
      if (selectedTemplate) params.set("slug", selectedTemplate);
      const res = await fetch(`/api/admin/send-email/preview?${params}`);
      const data = await res.json();
      if (res.ok) {
        setRecipients(data.recipients);
      } else {
        setResult({ type: "error", message: data.error });
      }
    } catch {
      setResult({ type: "error", message: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!selectedTemplate || !recipients?.length) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: selectedTemplate,
          audience,
          cooldownDays,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          type: "success",
          message: `Sent to ${data.sent} recipient(s)`,
        });
      } else {
        setResult({ type: "error", message: data.error });
      }
    } catch {
      setResult({ type: "error", message: "Network error" });
    } finally {
      setSending(false);
    }
  }

  const template = templates.find((t) => t.slug === selectedTemplate);

  return (
    <div className="space-y-4">
      {/* Template selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. Select Template</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Choose a template...</option>
            {templates.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name} ({t.category})
              </option>
            ))}
          </select>
          {template && (
            <p className="text-muted-foreground mt-2 text-xs">
              Subject: {template.subject}
            </p>
          )}
          <div className="mt-3">
            <label className="text-muted-foreground mb-1 block text-xs font-medium">
              Cooldown (skip users who received this template within)
            </label>
            <select
              value={cooldownDays}
              onChange={(e) => {
                setCooldownDays(Number(e.target.value));
                setRecipients(null);
              }}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            >
              <option value={0}>No cooldown (send to everyone)</option>
              <option value={7}>7 days</option>
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Audience selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">2. Select Audience</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <select
                value={audience}
                onChange={(e) => {
                  setAudience(e.target.value);
                  setRecipients(null);
                }}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              >
                {AUDIENCE_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} - {f.description}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviewAudience}
              disabled={loading}
            >
              <IconUsers className="mr-1.5 size-4" />
              {loading ? "Loading..." : "Preview recipients"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recipients preview */}
      {recipients && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              3. Recipients ({recipients.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recipients.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No users match this filter.
              </p>
            ) : (
              <>
                <div className="mb-3 flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {recipients.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="text-muted-foreground truncate">
                        {r.name}
                      </span>
                      <span className="font-mono text-xs">{r.email}</span>
                    </div>
                  ))}
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      disabled={!selectedTemplate || sending}
                    >
                      {sending ? (
                        <IconLoader2 className="mr-1.5 size-4 animate-spin" />
                      ) : (
                        <IconSend className="mr-1.5 size-4" />
                      )}
                      {sending
                        ? "Sending..."
                        : `Send to ${recipients.length} recipient(s)`}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Send email</AlertDialogTitle>
                      <AlertDialogDescription>
                        Send &quot;{template?.name}&quot; to{" "}
                        {recipients.length} recipient(s)? This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleSend}>
                        Send
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <div
          className={`flex items-center gap-2 rounded-md p-3 text-sm ${
            result.type === "success"
              ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300"
              : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {result.type === "success" ? (
            <IconCheck className="size-4" />
          ) : (
            <IconAlertTriangle className="size-4" />
          )}
          {result.message}
        </div>
      )}
    </div>
  );
}
