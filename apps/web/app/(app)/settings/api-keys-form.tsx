"use client";

import { useActionState, useTransition } from "react";
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
import { updateApiKeys, removeApiKey } from "../actions";

export function ApiKeysForm({
  openaiApiKey,
  anthropicApiKey,
  googleApiKey,
  cohereApiKey,
  isOwner,
}: {
  // Masked previews (e.g. "sk-abc••••••••wxyz"), not full keys. The server masks
  // the decrypted key so plaintext never reaches the browser.
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  googleApiKey: string | null;
  cohereApiKey: string | null;
  isOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateApiKeys, {});
  const [removing, startTransition] = useTransition();

  function handleRemove(keyField: "openaiApiKey" | "anthropicApiKey" | "googleApiKey" | "cohereApiKey") {
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
        <form action={formAction} className="space-y-5">
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
            />
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
            />
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
            />
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
            />
            <p className="text-xs text-muted-foreground">
              Used to improve search relevance with Cohere Rerank.
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
              Only owners can manage API keys.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
