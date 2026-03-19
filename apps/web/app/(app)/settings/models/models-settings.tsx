"use client";

import { useState, useTransition, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { IconPencil, IconCheck, IconX, IconSearch, IconLoader2 } from "@tabler/icons-react";
import { updateDefaultModels } from "../../actions";
import { updateRepoModels } from "../../repositories/actions";
import { searchRepoModels, type RepoModelItem } from "./actions";

type AvailableModel = {
  modelId: string;
  displayName: string;
  provider: string;
  category: string;
};

function getModelDisplayName(modelId: string | null, models: AvailableModel[]): string {
  if (!modelId) return "Org Default";
  const model = models.find((m) => m.modelId === modelId);
  return model ? model.displayName : modelId;
}

function RepoModelRow({
  repo,
  availableModels,
  isOwner,
}: {
  repo: RepoModelItem;
  availableModels: AvailableModel[];
  isOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [reviewModelId, setReviewModelId] = useState(repo.reviewModelId ?? "");
  const [embedModelId, setEmbedModelId] = useState(repo.embedModelId ?? "");
  const [savedReviewModelId, setSavedReviewModelId] = useState(repo.reviewModelId);
  const [savedEmbedModelId, setSavedEmbedModelId] = useState(repo.embedModelId);
  const [saving, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const llmModels = availableModels.filter((m) => m.category === "llm");
  const embedModels = availableModels.filter((m) => m.category === "embedding");

  const handleSave = () => {
    startTransition(async () => {
      const newReview = reviewModelId || null;
      const newEmbed = embedModelId || null;
      await updateRepoModels(repo.id, newReview, newEmbed);
      setSavedReviewModelId(newReview);
      setSavedEmbedModelId(newEmbed);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleCancel = () => {
    setReviewModelId(savedReviewModelId ?? "");
    setEmbedModelId(savedEmbedModelId ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{repo.fullName}</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={saving}
              className="h-7 px-2"
            >
              <IconX className="size-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-7 px-2"
            >
              {saving ? "Saving..." : <IconCheck className="size-3.5" />}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Review & Chat Model</Label>
            <select
              value={reviewModelId}
              onChange={(e) => setReviewModelId(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors"
            >
              <option value="">(Org Default)</option>
              {llmModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName} ({m.provider})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Embedding Model</Label>
            <select
              value={embedModelId}
              onChange={(e) => setEmbedModelId(e.target.value)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm transition-colors"
            >
              <option value="">(Org Default)</option>
              {embedModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName} ({m.provider})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2 rounded-md border bg-muted/10 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium truncate block">{repo.fullName}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Review:</span>
            <Badge
              variant={savedReviewModelId ? "default" : "secondary"}
              className="text-[10px] font-normal h-5"
            >
              {getModelDisplayName(savedReviewModelId, availableModels)}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Embed:</span>
            <Badge
              variant={savedEmbedModelId ? "default" : "secondary"}
              className="text-[10px] font-normal h-5"
            >
              {getModelDisplayName(savedEmbedModelId, availableModels)}
            </Badge>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-2">
        {saved && (
          <span className="text-xs text-green-600">Saved</span>
        )}
        {isOwner && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="h-7 px-2"
          >
            <IconPencil className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function RepositoryModelsSection({
  initialRepos,
  totalRepoCount,
  availableModels,
  isOwner,
}: {
  initialRepos: RepoModelItem[];
  totalRepoCount: number;
  availableModels: AvailableModel[];
  isOwner: boolean;
}) {
  const [repos, setRepos] = useState<RepoModelItem[]>(initialRepos);
  const [total, setTotal] = useState(totalRepoCount);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isSearching = query.length > 0;

  const doSearch = useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      const result = await searchRepoModels(searchQuery, 0, PAGE_SIZE);
      setRepos(result.repos);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(value);
    }, 300);
  };

  // Reset to initial when search is cleared
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleShowMore = async () => {
    setLoading(true);
    try {
      const result = await searchRepoModels(query, repos.length, PAGE_SIZE);
      setRepos((prev) => [...prev, ...result.repos]);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  };

  const remaining = total - repos.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repository Models</CardTitle>
        <CardDescription>
          Override organization defaults for individual repositories.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {totalRepoCount === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No repositories. Connect GitHub or Bitbucket to get started.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search repositories..."
                value={query}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>

            {loading && repos.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : repos.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No repositories found for &quot;{query}&quot;
              </div>
            ) : (
              <div className="space-y-2">
                {repos.map((repo) => (
                  <RepoModelRow
                    key={repo.id}
                    repo={repo}
                    availableModels={availableModels}
                    isOwner={isOwner}
                  />
                ))}
              </div>
            )}

            {remaining > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleShowMore}
                disabled={loading}
              >
                {loading ? (
                  <IconLoader2 className="size-4 animate-spin mr-2" />
                ) : null}
                {loading ? "Loading..." : `${remaining} more`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ModelsSettings({
  isOwner,
  availableModels,
  currentModelId,
  currentEmbedModelId,
  initialRepos,
  totalRepoCount,
}: {
  isOwner: boolean;
  availableModels: AvailableModel[];
  currentModelId: string | null;
  currentEmbedModelId: string | null;
  initialRepos: RepoModelItem[];
  totalRepoCount: number;
}) {
  const [selectedModelId, setSelectedModelId] = useState(currentModelId ?? "");
  const [selectedEmbedModelId, setSelectedEmbedModelId] = useState(currentEmbedModelId ?? "");
  const [saving, startTransition] = useTransition();
  const [saveResult, setSaveResult] = useState<{ error?: string; success?: boolean }>({});

  const llmModels = availableModels.filter((m) => m.category === "llm");
  const embedModels = availableModels.filter((m) => m.category === "embedding");

  return (
    <div className="space-y-6">
      {/* Organization Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Organization Defaults</CardTitle>
          <CardDescription>
            Default AI models for all repositories in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={(formData) => {
              startTransition(async () => {
                setSaveResult({});
                const result = await updateDefaultModels({}, formData);
                setSaveResult(result);
              });
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="defaultModelId">Review & Chat Model</Label>
              <select
                id="defaultModelId"
                name="defaultModelId"
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                disabled={!isOwner}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">(Platform Default)</option>
                {llmModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.displayName} ({m.provider})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Used for PR reviews, analysis, summaries, and chat.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="defaultEmbedModelId">Embedding Model</Label>
              <select
                id="defaultEmbedModelId"
                name="defaultEmbedModelId"
                value={selectedEmbedModelId}
                onChange={(e) => setSelectedEmbedModelId(e.target.value)}
                disabled={!isOwner}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">(Platform Default)</option>
                {embedModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.displayName} ({m.provider})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Used for code search and context retrieval.
              </p>
            </div>

            {saveResult.error && (
              <p className="text-sm text-destructive">{saveResult.error}</p>
            )}
            {saveResult.success && (
              <p className="text-sm text-green-600">Default models updated.</p>
            )}

            <Button
              type="submit"
              disabled={saving || !isOwner}
              className="w-full"
              size="sm"
            >
              {saving ? "Saving..." : "Save Defaults"}
            </Button>

            {!isOwner && (
              <p className="text-muted-foreground text-center text-xs">
                Only owners can change default models.
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Repository Models */}
      <RepositoryModelsSection
        initialRepos={initialRepos}
        totalRepoCount={totalRepoCount}
        availableModels={availableModels}
        isOwner={isOwner}
      />
    </div>
  );
}
