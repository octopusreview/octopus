"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  IconArrowLeft,
  IconDeviceFloppy,
  IconSend,
  IconEye,
  IconCheck,
  IconAlertTriangle,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateTemplateAction, deleteTemplateAction } from "../actions";

interface Template {
  id: string;
  slug: string;
  name: string;
  category: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  buttonText: string | null;
  buttonUrl: string | null;
  signatureName: string | null;
  signatureTitle: string | null;
  variables: string[];
  system: boolean;
  enabled: boolean;
}

export function TemplateEditor({ template }: { template: Template }) {
  const [name, setName] = useState(template.name);
  const [slug, setSlug] = useState(template.slug);
  const [category, setCategory] = useState(template.category);
  const [fromName, setFromName] = useState(template.fromName);
  const [fromEmail, setFromEmail] = useState(template.fromEmail);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [buttonText, setButtonText] = useState(template.buttonText || "");
  const [buttonUrl, setButtonUrl] = useState(template.buttonUrl || "");
  const [signatureName, setSignatureName] = useState(template.signatureName || "");
  const [signatureTitle, setSignatureTitle] = useState(template.signatureTitle || "");
  const [enabled, setEnabled] = useState(template.enabled);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const router = useRouter();
  const [previewHtml, setPreviewHtml] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const fetchPreview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/test-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromName,
          fromEmail,
          subject,
          body,
          buttonText,
          buttonUrl,
          signatureName,
          signatureTitle,
        }),
      });
      if (res.ok) {
        setPreviewHtml(await res.text());
      }
    } catch (err) {
      console.error("Preview fetch failed:", err);
    }
  }, [fromName, fromEmail, subject, body, buttonText, buttonUrl, signatureName, signatureTitle]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchPreview, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchPreview]);

  async function handleSave() {
    setSaving(true);
    setFeedback(null);
    try {
      await updateTemplateAction(template.slug, {
        slug,
        name,
        category,
        fromName,
        fromEmail,
        subject,
        body,
        buttonText: buttonText.trim() || null,
        buttonUrl: buttonUrl.trim() || null,
        signatureName: signatureName.trim() || null,
        signatureTitle: signatureTitle.trim() || null,
        enabled,
      });
      setFeedback({ type: "success", message: "Saved" });
      setTimeout(() => setFeedback(null), 4000);
    } catch {
      setFeedback({ type: "error", message: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTest() {
    setSendingTest(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: template.slug }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: "success", message: `Test sent to ${data.to}` });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({ type: "error", message: data.error });
      }
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setSendingTest(false);
    }
  }

  async function handleGenerate() {
    if (!aiTopic.trim()) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: aiTopic }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.name) setName(data.name);
        if (data.subject) setSubject(data.subject);
        if (data.body) setBody(data.body);
        if (data.buttonText !== undefined) setButtonText(data.buttonText || "");
        if (data.buttonUrl !== undefined) setButtonUrl(data.buttonUrl || "");
        if (data.signatureName) setSignatureName(data.signatureName);
        if (data.signatureTitle) setSignatureTitle(data.signatureTitle);
        setFeedback({ type: "success", message: "Generated" });
        setTimeout(() => setFeedback(null), 4000);
        setAiTopic("");
      } else {
        setFeedback({ type: "error", message: data.error || "Generation failed" });
      }
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteTemplateAction(template.slug);
      router.push("/admin/email-templates");
    } catch {
      setFeedback({ type: "error", message: "Failed to delete" });
    }
  }

  function handlePreview() {
    const blob = new Blob([previewHtml || "<p>Loading preview...</p>"], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href="/admin/email-templates"
          className="text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">{template.name}</h2>
          <p className="text-muted-foreground text-sm">
            slug: <code className="text-xs">{template.slug}</code>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {feedback && (
            <span
              className={`flex items-center gap-1 text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-500"}`}
            >
              {feedback.type === "success" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconAlertTriangle className="size-4" />
              )}
              {feedback.message}
            </span>
          )}
        </div>
      </div>

      {/* Variables reference */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Variables:</span>
        {template.variables.map((v) => (
          <Badge key={v} variant="outline" className="font-mono text-[11px]">
            {`{{${v}}}`}
          </Badge>
        ))}
      </div>

      <div className="space-y-4">
        {/* AI Generate */}
        <Card>
          <CardContent className="flex items-center gap-2 p-4">
            <IconSparkles className="text-muted-foreground size-4 shrink-0" />
            <input
              type="text"
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerate();
              }}
              placeholder="Describe the email you want to create..."
              className="border-input bg-background flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || !aiTopic.trim()}
            >
              <IconSparkles className="mr-1.5 size-4" />
              {generating ? "Generating..." : "Generate"}
            </Button>
          </CardContent>
        </Card>

        {/* Editor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Template Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Slug
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                >
                  <option value="transactional">Transactional</option>
                  <option value="notification">Notification</option>
                  <option value="marketing">Marketing</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  From Name
                </label>
                <input
                  type="text"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="e.g. John from Octopus"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  From Email
                </label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="e.g. john@example.com"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">
                Body
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono leading-relaxed"
              />
              <p className="text-muted-foreground mt-1 text-[11px]">
                Supports: **bold**, [link text](url), `code`, bullet points (-
                item)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Button Text (optional)
                </label>
                <input
                  type="text"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder="e.g. Get Started"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Button URL (optional)
                </label>
                <input
                  type="text"
                  value={buttonUrl}
                  onChange={(e) => setButtonUrl(e.target.value)}
                  placeholder="e.g. {{appUrl}}/dashboard"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Signature Name (optional)
                </label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="e.g. John"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs font-medium">
                  Signature Title (optional)
                </label>
                <input
                  type="text"
                  value={signatureTitle}
                  onChange={(e) => setSignatureTitle(e.target.value)}
                  placeholder="e.g. Founder"
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">
              If both are set, a &quot;-Name / Title&quot; signature is appended to the email.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-4 rounded"
              />
              <label htmlFor="enabled" className="text-sm">
                Enabled
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Preview iframe */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              className="border-input h-[700px] w-full rounded-md border"
              title="Email preview"
            />
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          <IconDeviceFloppy className="mr-1.5 size-4" />
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={handlePreview}>
          <IconEye className="mr-1.5 size-4" />
          Preview in new tab
        </Button>
        <Button
          variant="outline"
          onClick={handleSendTest}
          disabled={sendingTest}
        >
          <IconSend className="mr-1.5 size-4" />
          {sendingTest ? "Sending..." : "Send test to me"}
        </Button>
        <div className="flex-1" />
        {!template.system && <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <IconTrash className="mr-1.5 size-4" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete template</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{name}&quot;? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>}
      </div>
    </>
  );
}
