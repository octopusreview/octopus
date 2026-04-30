"use client";

import { useState, useEffect, useActionState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  IconBook,
  IconPlus,
  IconTrash,
  IconLoader2,
  IconCheck,
  IconAlertTriangle,
  IconUpload,
  IconClipboard,
  IconFileText,
  IconCube,
  IconFiles,
  IconCircleCheck,
  IconPencil,
  IconDeviceFloppy,
  IconX,
  IconArrowBackUp,
  IconChevronDown,
  IconHistory,
  IconSparkles,
} from "@tabler/icons-react";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocument,
  updateKnowledgeDocument,
  restoreKnowledgeDocument,
  getKnowledgeAuditLogs,
  enhanceKnowledgeContent,
  setKnowledgeAlwaysInclude,
} from "./actions";
import { Switch } from "@/components/ui/switch";
import { IconPin } from "@tabler/icons-react";
import { getPubbyClient } from "@/lib/pubby-client";
import { TemplateBrowser } from "./template-browser";

type Document = {
  id: string;
  title: string;
  sourceType: string;
  fileName: string | null;
  status: string;
  errorMessage: string | null;
  totalChunks: number;
  totalVectors: number;
  processingMs: number | null;
  alwaysInclude: boolean;
  createdAt: string;
};

type DeletedDocument = {
  id: string;
  title: string;
  deletedAt: string;
  deletedByName: string | null;
};

type AuditLog = {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
  userName: string;
};

type Props = {
  documents: Document[];
  deletedDocuments: DeletedDocument[];
  addedTemplateIds: string[];
  orgId: string;
};

export function KnowledgeContent({ documents: initialDocuments, deletedDocuments: initialDeleted, addedTemplateIds, orgId }: Props) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [deletedDocs, setDeletedDocs] = useState(initialDeleted);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourceType, setSourceType] = useState<"paste" | "file">("paste");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSubmitted = useRef(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [restoringId, startRestoreTransition] = useTransition();

  const [formState, formAction, isPending] = useActionState(
    createKnowledgeDocument,
    {},
  );

  const [deletingId, startDeleteTransition] = useTransition();
  const [enhancing, setEnhancing] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDoc, setSheetDoc] = useState<Document | null>(null);
  const [sheetContent, setSheetContent] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Track when form is submitted
  useEffect(() => {
    if (isPending) {
      hasSubmitted.current = true;
    }
  }, [isPending]);

  // Close dialog on successful submission
  useEffect(() => {
    if (hasSubmitted.current && !isPending && !formState.error) {
      hasSubmitted.current = false;
      setDialogOpen(false);
      setSourceType("paste");
      setFileName(null);
      setFileContent("");
    }
  }, [isPending, formState]);

  // Sync with server data
  useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);

  useEffect(() => {
    setDeletedDocs(initialDeleted);
  }, [initialDeleted]);

  // Real-time updates via Pubby
  useEffect(() => {
    const pubby = getPubbyClient();
    const channel = pubby.subscribe(`presence-org-${orgId}`);

    const handler = (raw: unknown) => {
      const data = raw as {
        documentId: string;
        status: string;
        totalChunks?: number;
        totalVectors?: number;
        error?: string;
      };
      if (data.status === "deleted") {
        setDocuments((prev) => prev.filter((d) => d.id !== data.documentId));
        router.refresh();
        return;
      }

      if (data.status === "restored") {
        setDeletedDocs((prev) => prev.filter((d) => d.id !== data.documentId));
        router.refresh();
        return;
      }

      if (data.status === "ready" || data.status === "error") {
        router.refresh();
        return;
      }

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === data.documentId
            ? {
                ...d,
                status: data.status,
                ...(data.totalChunks !== undefined
                  ? { totalChunks: data.totalChunks }
                  : {}),
                ...(data.totalVectors !== undefined
                  ? { totalVectors: data.totalVectors }
                  : {}),
              }
            : d,
        ),
      );
    };

    channel.bind("knowledge-status", handler);

    return () => {
      channel.unbind("knowledge-status", handler);
    };
  }, [orgId, router]);

  async function handleEnhance() {
    const textarea = contentRef.current;
    if (!textarea || !textarea.value.trim()) return;

    setEnhancing(true);
    const result = await enhanceKnowledgeContent(textarea.value);
    setEnhancing(false);

    if (result.content) {
      // Update the textarea value via native setter to trigger React's onChange
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, result.content);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileContent(ev.target?.result as string);
    };
    reader.readAsText(file);
  }

  async function handleOpenSheet(doc: Document) {
    setSheetDoc(doc);
    setSheetOpen(true);
    setEditMode(false);
    setSaveError(null);
    setSheetLoading(true);
    setAuditLogs([]);

    const [result, logs] = await Promise.all([
      getKnowledgeDocument(doc.id),
      getKnowledgeAuditLogs(doc.id),
    ]);

    if ("error" in result) {
      setSheetContent("");
    } else {
      setSheetContent(result.content);
    }
    setAuditLogs(logs);
    setSheetLoading(false);
  }

  function handleEnterEdit() {
    if (!sheetDoc) return;
    setEditTitle(sheetDoc.title);
    setEditContent(sheetContent);
    setSaveError(null);
    setEditMode(true);
  }

  async function handleSave() {
    if (!sheetDoc) return;
    setSaving(true);
    setSaveError(null);

    const fd = new FormData();
    fd.set("title", editTitle);
    fd.set("content", editContent);

    const result = await updateKnowledgeDocument(sheetDoc.id, fd);
    setSaving(false);

    if (result.error) {
      setSaveError(result.error);
      return;
    }

    setSheetContent(editContent);
    setSheetDoc((prev) => prev ? { ...prev, title: editTitle, status: "processing" } : prev);
    setEditMode(false);
  }

  // Keep sheetDoc in sync with documents list (for real-time status updates)
  useEffect(() => {
    if (!sheetDoc) return;
    const updated = documents.find((d) => d.id === sheetDoc.id);
    if (updated) {
      setSheetDoc(updated);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depend on sheetDoc.id only
  }, [documents, sheetDoc?.id]);

  function handleDelete(documentId: string) {
    startDeleteTransition(async () => {
      await deleteKnowledgeDocument(documentId);
    });
  }

  async function handleAlwaysIncludeToggle(documentId: string, next: boolean) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === documentId ? { ...d, alwaysInclude: next } : d)),
    );
    const result = await setKnowledgeAlwaysInclude(documentId, next);
    if (result.error) {
      setDocuments((prev) =>
        prev.map((d) => (d.id === documentId ? { ...d, alwaysInclude: !next } : d)),
      );
    }
  }

  function handleRestore(documentId: string) {
    startRestoreTransition(async () => {
      await restoreKnowledgeDocument(documentId);
    });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your coding standards, guidelines, and rules. They will be
            used during code reviews and analysis.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <TemplateBrowser addedTemplateIds={addedTemplateIds} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconPlus className="mr-2 size-4" />
                Add Document
              </Button>
            </DialogTrigger>
          <DialogContent className="max-h-[85vh] sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Knowledge Document</DialogTitle>
              <DialogDescription>
                Paste or upload your coding standards, guidelines, or rules.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="e.g. TypeScript Coding Standards"
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={sourceType === "paste" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSourceType("paste")}
                >
                  <IconClipboard className="mr-1 size-3.5" />
                  Paste
                </Button>
                <Button
                  type="button"
                  variant={sourceType === "file" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSourceType("file")}
                >
                  <IconUpload className="mr-1 size-3.5" />
                  Upload File
                </Button>
              </div>

              {sourceType === "paste" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="content">Content</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleEnhance}
                      disabled={enhancing}
                      className="h-7 gap-1.5 text-xs"
                    >
                      {enhancing ? (
                        <IconLoader2 className="size-3 animate-spin" />
                      ) : (
                        <IconSparkles className="size-3" />
                      )}
                      Enhance with AI
                    </Button>
                  </div>
                  <Textarea
                    ref={contentRef}
                    id="content"
                    name="content"
                    className="max-h-[40vh] min-h-[200px]"
                    placeholder="Paste your guidelines, coding standards, or rules here..."
                    rows={10}
                    required
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>File (.md, .txt)</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.txt"
                    onChange={handleFileChange}
                  />
                  {fileName && (
                    <p className="text-xs text-muted-foreground">
                      Selected: {fileName}
                    </p>
                  )}
                  <input type="hidden" name="content" value={fileContent} />
                </div>
              )}

              <input type="hidden" name="sourceType" value={sourceType} />
              <input type="hidden" name="fileName" value={fileName ?? ""} />

              {formState.error && (
                <p className="text-sm text-destructive">{formState.error}</p>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isPending}>
                  {isPending && (
                    <IconLoader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Add Document
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                Documents
              </span>
              <IconFiles className="size-3.5 text-muted-foreground sm:size-4" />
            </div>
            <div className="mt-1 text-2xl font-bold sm:text-3xl">
              {documents.length}
            </div>
          </Card>
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                Ready
              </span>
              <IconCircleCheck className="size-3.5 text-muted-foreground sm:size-4" />
            </div>
            <div className="mt-1 text-2xl font-bold sm:text-3xl">
              {documents.filter((d) => d.status === "ready").length}
            </div>
          </Card>
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                Chunks
              </span>
              <IconFileText className="size-3.5 text-muted-foreground sm:size-4" />
            </div>
            <div className="mt-1 text-2xl font-bold sm:text-3xl">
              {documents.reduce((sum, d) => sum + d.totalChunks, 0)}
            </div>
          </Card>
          <Card className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                Vectors
              </span>
              <IconCube className="size-3.5 text-muted-foreground sm:size-4" />
            </div>
            <div className="mt-1 text-2xl font-bold sm:text-3xl">
              {documents.reduce((sum, d) => sum + d.totalVectors, 0)}
            </div>
          </Card>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-16">
          <IconBook className="mb-3 size-10 text-muted-foreground/40" />
          <h3 className="font-medium">No documents yet</h3>
          <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
            Add your coding standards, guidelines, or rules to enhance AI
            reviews. Start with a template or create your own.
          </p>
          <div className="mt-4">
            <TemplateBrowser addedTemplateIds={addedTemplateIds} />
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-4 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleOpenSheet(doc)}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <IconFileText className="size-4 text-muted-foreground" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{doc.title}</span>
                  <StatusBadge status={doc.status} />
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    {doc.sourceType === "file" && doc.fileName
                      ? doc.fileName
                      : doc.sourceType === "template"
                        ? "From template"
                        : "Pasted content"}
                  </span>
                  {doc.status === "ready" && (
                    <>
                      <span className="flex items-center gap-1">
                        <IconFileText className="size-3" />
                        {doc.totalChunks} chunks
                      </span>
                      <span className="flex items-center gap-1">
                        <IconCube className="size-3" />
                        {doc.totalVectors} vectors
                      </span>
                    </>
                  )}
                  <span>{formatDate(doc.createdAt)}</span>
                </div>
                {doc.status === "error" && doc.errorMessage && (
                  <p className="mt-1 text-xs text-destructive">
                    {doc.errorMessage}
                  </p>
                )}
              </div>

              <div
                className="flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <label
                  className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
                  title="Pin: include in every review regardless of diff similarity"
                >
                  <IconPin className={`size-3.5 ${doc.alwaysInclude ? "text-primary" : ""}`} />
                  <span className="hidden sm:inline">Pin</span>
                  <Switch
                    checked={doc.alwaysInclude}
                    onCheckedChange={(v) => handleAlwaysIncludeToggle(doc.id, v)}
                    disabled={doc.status !== "ready"}
                    aria-label="Always include in reviews"
                  />
                </label>
              </div>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => e.stopPropagation()}
                    disabled={!!deletingId}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete document?</AlertDialogTitle>
                    <AlertDialogDescription>
                      &quot;{doc.title}&quot; will be moved to deleted documents. Its vector chunks will be removed but the document can be restored later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDelete(doc.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {/* Deleted Documents Section */}
      {deletedDocs.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setDeletedOpen(!deletedOpen)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <IconChevronDown
              className={`size-4 transition-transform ${deletedOpen ? "" : "-rotate-90"}`}
            />
            <IconTrash className="size-4" />
            Deleted Documents ({deletedDocs.length})
          </button>

          {deletedOpen && (
            <div className="mt-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconAlertTriangle className="size-3.5 shrink-0" />
                Documents not restored within 7 days will be permanently deleted.
              </p>
              {deletedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 rounded-lg border border-dashed px-4 py-3 opacity-60"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <IconTrash className="size-4 text-muted-foreground" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium">{doc.title}</span>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Deleted {formatDate(doc.deletedAt)}
                      {doc.deletedByName && ` by ${doc.deletedByName}`}
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={!!restoringId}
                      >
                        <IconArrowBackUp className="mr-1.5 size-3.5" />
                        Restore
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Restore document?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &quot;{doc.title}&quot; will be restored and re-indexed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRestore(doc.id)}>
                          Restore
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => {
        setSheetOpen(open);
        if (!open) {
          setEditMode(false);
          setSaveError(null);
        }
      }}>
        <SheetContent className="data-[side=right]:sm:max-w-[85vw] flex flex-col overflow-hidden p-0">
          {/* Sticky header */}
          <div className="sticky top-0 z-10 border-b bg-background px-6 py-4">
            <SheetHeader className="p-0">
              <div className="flex items-center justify-between gap-4">
                <SheetTitle className="flex items-center gap-2">
                  {editMode ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="text-lg font-semibold"
                    />
                  ) : (
                    <span className="truncate">{sheetDoc?.title}</span>
                  )}
                </SheetTitle>
              </div>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {sheetDoc && <StatusBadge status={sheetDoc.status} />}
                {sheetDoc?.status === "ready" && (
                  <>
                    <span className="flex items-center gap-1 text-xs">
                      <IconFileText className="size-3" />
                      {sheetDoc.totalChunks} chunks
                    </span>
                    <span className="flex items-center gap-1 text-xs">
                      <IconCube className="size-3" />
                      {sheetDoc.totalVectors} vectors
                    </span>
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            {/* Action buttons in header */}
            {!sheetLoading && (
              <div className="mt-3 flex items-center gap-2">
                {editMode ? (
                  <>
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? (
                        <IconLoader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <IconDeviceFloppy className="mr-2 size-4" />
                      )}
                      Save & Re-index
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditMode(false);
                        setSaveError(null);
                      }}
                      disabled={saving}
                    >
                      <IconX className="mr-2 size-4" />
                      Cancel
                    </Button>
                    {saveError && (
                      <p className="text-sm text-destructive">{saveError}</p>
                    )}
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnterEdit}
                    disabled={sheetDoc?.status === "processing"}
                  >
                    <IconPencil className="mr-2 size-4" />
                    Edit
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {sheetLoading ? (
              <div className="flex items-center justify-center py-12">
                <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : editMode ? (
              <div className="space-y-2">
                <Label htmlFor="edit-content">Content</Label>
                <Textarea
                  id="edit-content"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[400px] font-mono text-sm"
                />
              </div>
            ) : (
              <>
                <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-4 font-mono text-sm">
                  {sheetContent}
                </pre>

                {/* Activity Log */}
                {auditLogs.length > 0 && (
                  <div className="mt-6">
                    <h3 className="flex items-center gap-2 text-sm font-medium">
                      <IconHistory className="size-4" />
                      Activity
                    </h3>
                    <div className="mt-3 space-y-3">
                      {auditLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-3 text-sm">
                          <div className="mt-0.5 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                          <div>
                            <span className="font-medium">{log.userName}</span>{" "}
                            <span className="text-muted-foreground">
                              {log.action === "created" && "created this document"}
                              {log.action === "updated" && "updated this document"}
                              {log.action === "deleted" && "deleted this document"}
                              {log.action === "restored" && "restored this document"}
                            </span>
                            {log.details && (
                              <span className="text-muted-foreground"> — {log.details}</span>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {formatDate(log.createdAt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "processing":
      return (
        <Badge variant="secondary" className="gap-1">
          <IconLoader2 className="size-3 animate-spin" />
          Processing
        </Badge>
      );
    case "ready":
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          <IconCheck className="size-3" />
          Ready
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <IconAlertTriangle className="size-3" />
          Error
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
