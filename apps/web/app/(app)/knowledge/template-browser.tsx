"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  IconTemplate,
  IconPlus,
  IconCheck,
  IconLoader2,
  IconEye,
  IconCode,
  IconShield,
  IconTestPipe,
  IconSitemap,
  IconGitPullRequest,
} from "@tabler/icons-react";
import {
  knowledgeTemplates,
  type KnowledgeTemplate,
  type KnowledgeTemplateCategory,
} from "@/lib/knowledge-templates";
import { addKnowledgeTemplate } from "./actions";
import { toast } from "sonner";

const categoryConfig: Record<
  KnowledgeTemplateCategory,
  { label: string; icon: React.ReactNode; color: string }
> = {
  language: {
    label: "Language",
    icon: <IconCode className="size-3" />,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  process: {
    label: "Process",
    icon: <IconGitPullRequest className="size-3" />,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  security: {
    label: "Security",
    icon: <IconShield className="size-3" />,
    color: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  testing: {
    label: "Testing",
    icon: <IconTestPipe className="size-3" />,
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  architecture: {
    label: "Architecture",
    icon: <IconSitemap className="size-3" />,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

const allCategories: KnowledgeTemplateCategory[] = [
  "language",
  "process",
  "security",
  "testing",
  "architecture",
];

export function TemplateBrowser({
  addedTemplateIds,
}: {
  addedTemplateIds: string[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<KnowledgeTemplateCategory | null>(null);
  const [previewTemplate, setPreviewTemplate] =
    useState<KnowledgeTemplate | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<Set<string>>(
    new Set(addedTemplateIds),
  );

  const filtered = activeCategory
    ? knowledgeTemplates.filter((t) => t.category === activeCategory)
    : knowledgeTemplates;

  function handleAdd(templateId: string) {
    startTransition(async () => {
      const result = await addKnowledgeTemplate(templateId);
      if (result.error) {
        toast.error(result.error);
      } else {
        setAddedIds((prev) => new Set(prev).add(templateId));
        toast.success("Template added to your knowledge base.");
      }
    });
  }

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="shrink-0">
            <IconTemplate className="mr-2 size-4" />
            Browse Templates
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Knowledge Templates</DialogTitle>
            <DialogDescription>
              Pre-built coding standards and guidelines. Add them to your
              knowledge base with one click, then customize as needed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={activeCategory === null ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActiveCategory(null)}
            >
              All
            </Button>
            {allCategories.map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() =>
                  setActiveCategory(activeCategory === cat ? null : cat)
                }
              >
                {categoryConfig[cat].icon}
                {categoryConfig[cat].label}
              </Button>
            ))}
          </div>

          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {filtered.map((template) => {
              const isAdded = addedIds.has(template.id);
              const cat = categoryConfig[template.category];

              return (
                <Card key={template.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {template.title}
                        </span>
                        <Badge
                          variant="secondary"
                          className={`gap-1 text-[10px] ${cat.color}`}
                        >
                          {cat.icon}
                          {cat.label}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => setPreviewTemplate(template)}
                      >
                        <IconEye className="size-3.5" />
                        Preview
                      </Button>
                      {isAdded ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          disabled
                        >
                          <IconCheck className="size-3.5" />
                          Added
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => handleAdd(template.id)}
                          disabled={!!isPending}
                        >
                          {isPending ? (
                            <IconLoader2 className="size-3.5 animate-spin" />
                          ) : (
                            <IconPlus className="size-3.5" />
                          )}
                          Add
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Sheet */}
      <Sheet
        open={!!previewTemplate}
        onOpenChange={(open) => {
          if (!open) setPreviewTemplate(null);
        }}
      >
        <SheetContent className="data-[side=right]:sm:max-w-[85vw] flex flex-col overflow-hidden p-0">
          <div className="sticky top-0 z-10 border-b bg-background px-6 py-4">
            <SheetHeader className="p-0">
              <SheetTitle>{previewTemplate?.title}</SheetTitle>
              <SheetDescription>
                {previewTemplate?.description}
              </SheetDescription>
            </SheetHeader>
            {previewTemplate && !addedIds.has(previewTemplate.id) && (
              <Button
                size="sm"
                className="mt-3 gap-1"
                onClick={() => handleAdd(previewTemplate.id)}
                disabled={!!isPending}
              >
                {isPending ? (
                  <IconLoader2 className="size-3.5 animate-spin" />
                ) : (
                  <IconPlus className="size-3.5" />
                )}
                Add to Knowledge Base
              </Button>
            )}
            {previewTemplate && addedIds.has(previewTemplate.id) && (
              <Badge
                variant="secondary"
                className="mt-3 gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <IconCheck className="size-3" />
                Already added
              </Badge>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/50 p-4 font-mono text-sm">
              {previewTemplate?.content}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
