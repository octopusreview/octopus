"use client";

import { useActionState, useState, useTransition } from "react";
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
import { IconX } from "@tabler/icons-react";
import { apiKeysSchema, type ApiKeyField } from "@/lib/schemas/settings";
import { updateApiKeys, removeApiKey } from "../actions";

const API_KEY_FIELDS: ApiKeyField[] = [
  "openaiApiKey",
  "anthropicApiKey",
  "googleApiKey",
  "cohereApiKey",
  "grokApiKey",
  "openrouterApiKey",
  "alibabaApiKey",
];

type FieldErrors = Partial<Record<ApiKeyField, string>>;

export function ApiKeysForm({
  openaiApiKey,
  anthropicApiKey,
  googleApiKey,
  cohereApiKey,
  grokApiKey,
  openrouterApiKey,
  alibabaApiKey,
  isOwner,
}: {
  // Masked previews (e.g. "sk-abc••••••••wxyz"), not full keys. The server masks
  // the decrypted key so plaintext never reaches the browser.
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  googleApiKey: string | null;
  cohereApiKey: string | null;
  grokApiKey: string | null;
  openrouterApiKey: string | null;
  alibabaApiKey: string | null;
  isOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateApiKeys, {});
  const [removing, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(e.currentTarget);
    const values = Object.fromEntries(
      API_KEY_FIELDS.map((field) => [field, formData.get(field) ?? ""]),
    );
    const result = apiKeysSchema.safeParse(values);
    if (!result.success) {
      e.preventDefault();
      const errors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !errors[field as ApiKeyField]) {
          errors[field as ApiKeyField] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
  }

  function clearFieldError(field: ApiKeyField) {
    if (!fieldErrors[field]) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function fieldErrorProps(field: ApiKeyField) {
    const error = fieldErrors[field];
    return {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${field}-error` : undefined,
      onChange: () => clearFieldError(field),
    };
  }

  function renderFieldError(field: ApiKeyField) {
    const error = fieldErrors[field];
    if (!error) return null;
    return (
      <p id={`${field}-error`} className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  function handleRemove(keyField: ApiKeyField) {
    startTransition(async () => {
      try {
        await removeApiKey(keyField);
      } catch (error) {
        console.error("Failed to remove API key:", error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Keys</CardTitle>
        <CardDescription>
          AI provider keys used for code analysis and reviews.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">

          Optional. Leave blank to use Octopus default keys. Adding your own
          keys removes rate limits and lowers your usage costs.
        </div>
        <form action={formAction} onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="openaiApiKey">OpenAI</Label>
              {openaiApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {openaiApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("openaiApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="openaiApiKey"
              name="openaiApiKey"
              type="password"
              placeholder="sk-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("openaiApiKey")}
            />
            {renderFieldError("openaiApiKey")}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="anthropicApiKey">Anthropic</Label>
              {anthropicApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {anthropicApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("anthropicApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="anthropicApiKey"
              name="anthropicApiKey"
              type="password"
              placeholder="sk-ant-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("anthropicApiKey")}
            />
            {renderFieldError("anthropicApiKey")}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="googleApiKey">Google AI</Label>
              {googleApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {googleApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("googleApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="googleApiKey"
              name="googleApiKey"
              type="password"
              placeholder="AIza..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("googleApiKey")}
            />
            {renderFieldError("googleApiKey")}
            <p className="text-xs text-muted-foreground">
              Required for Gemini models.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="cohereApiKey">Cohere Rerank</Label>
              {cohereApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {cohereApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("cohereApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="cohereApiKey"
              name="cohereApiKey"
              type="password"
              placeholder="co-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("cohereApiKey")}
            />
            {renderFieldError("cohereApiKey")}
            <p className="text-xs text-muted-foreground">
              Used to improve search relevance with Cohere Rerank.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="grokApiKey">Grok (xAI)</Label>
              {grokApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {grokApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("grokApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="grokApiKey"
              name="grokApiKey"
              type="password"
              placeholder="xai-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("grokApiKey")}
            />
            {renderFieldError("grokApiKey")}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="openrouterApiKey">OpenRouter</Label>
              {openrouterApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {openrouterApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("openrouterApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="openrouterApiKey"
              name="openrouterApiKey"
              type="password"
              placeholder="sk-or-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("openrouterApiKey")}
            />
            {renderFieldError("openrouterApiKey")}
            <p className="text-xs text-muted-foreground">
              One key for many model vendors.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="alibabaApiKey">Alibaba Cloud Model Studio</Label>
              {alibabaApiKey ? (
                <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                  {alibabaApiKey}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => handleRemove("alibabaApiKey")}
                      disabled={removing}
                      className="text-muted-foreground hover:text-destructive -mr-1 ml-0.5"
                    >
                      <IconX size={12} />
                    </button>
                  )}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  Not set
                </Badge>
              )}
            </div>
            <Input
              id="alibabaApiKey"
              name="alibabaApiKey"
              type="password"
              placeholder="sk-..."
              disabled={!isOwner}
              autoComplete="off"
              {...fieldErrorProps("alibabaApiKey")}
            />
            {renderFieldError("alibabaApiKey")}
            <p className="text-xs text-muted-foreground">
              Required for Qwen models.
            </p>
          </div>
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state.success && (
            <p className="text-sm text-green-600">API keys updated.</p>
          )}

          <Button
            type="submit"
            disabled={pending || !isOwner}
            className="w-full"
            size="sm"
          >
            {pending ? "Saving..." : "Save Keys"}
          </Button>

          {!isOwner && (
            <p className="text-muted-foreground text-center text-xs">
              Only owners and admins can manage API keys.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
