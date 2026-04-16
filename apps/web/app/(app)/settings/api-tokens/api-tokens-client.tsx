"use client";

import { useState } from "react";
import { createApiToken, deleteApiToken } from "./actions";
import { toast } from "sonner";
import {
  IconCopy,
  IconTrash,
  IconPlus,
  IconTerminal2,
  IconCheck,
} from "@tabler/icons-react";

interface Token {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: { name: string; email: string };
}

export function ApiTokensClient({
  tokens,
  isOwner,
}: {
  tokens: Token[];
  isOwner: boolean;
}) {
  const [newToken, setNewToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function handleCreate(formData: FormData) {
    setCreating(true);
    const result = await createApiToken(formData);
    setCreating(false);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    setNewToken(result.token!);
    setShowForm(false);
    toast.success(`Token "${result.name}" created`);
  }

  async function handleDelete(formData: FormData) {
    const result = await deleteApiToken(formData);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Token deleted");
  }

  function copyToken() {
    if (newToken) {
      navigator.clipboard.writeText(newToken);
      toast.success("Token copied to clipboard");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">API Tokens</h2>
        <p className="text-muted-foreground text-sm">
          Create tokens for the Octopus CLI and API access. Tokens provide full
          access to your organization&apos;s data.
        </p>
      </div>

      {newToken && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
          <p className="mb-2 text-sm font-medium text-green-800 dark:text-green-200">
            Copy your token now — it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm dark:bg-stone-900">
              {newToken}
            </code>
            <button
              onClick={copyToken}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              <IconCopy className="size-4" />
            </button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="text-muted-foreground mt-2 text-xs hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {isOwner && (showForm ? (
        <form action={handleCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="token-name" className="text-sm font-medium">
              Token Name
            </label>
            <input
              id="token-name"
              name="name"
              type="text"
              placeholder="e.g. CI/CD, Local Dev"
              required
              className="mt-1 block w-full rounded-md border px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {creating ? "Creating..." : "Create Token"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="text-muted-foreground rounded-md px-4 py-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <IconPlus className="size-4" />
          Create Token
        </button>
      ))}

      {tokens.length > 0 ? (
        <div className="overflow-hidden rounded-lg border dark:border-stone-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Token</th>
                <th className="px-4 py-3 text-left font-medium">Created By</th>
                <th className="px-4 py-3 text-left font-medium">Last Used</th>
                <th className="px-4 py-3 text-left font-medium">Created</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr
                  key={token.id}
                  className="border-b last:border-0 dark:border-stone-700"
                >
                  <td className="px-4 py-3 font-medium">{token.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-muted-foreground text-xs">
                      {token.tokenPrefix}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {token.createdBy.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {token.lastUsedAt
                      ? new Date(token.lastUsedAt).toLocaleDateString()
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(token.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={handleDelete}>
                      <input type="hidden" name="tokenId" value={token.id} />
                      <button
                        type="submit"
                        className="text-muted-foreground hover:text-red-600"
                        title="Delete token"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm dark:border-stone-700">
          No API tokens yet. Create one to use the Octopus CLI.
        </div>
      )}

      <CliQuickStart />
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: clipboard API unavailable or denied
    }
  }

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md bg-stone-100 px-4 py-3 font-mono text-sm dark:bg-stone-800">
        <code>{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded-md p-1.5 text-stone-400 opacity-0 transition hover:bg-stone-200 hover:text-stone-600 group-hover:opacity-100 dark:hover:bg-stone-700 dark:hover:text-stone-300"
        title="Copy"
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

function CliQuickStart() {
  return (
    <div className="space-y-4 rounded-lg border p-5 dark:border-stone-700">
      <div className="flex items-center gap-2">
        <IconTerminal2 className="text-muted-foreground size-5" />
        <h3 className="text-sm font-semibold">CLI Quick Start</h3>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-muted-foreground mb-1.5 text-xs font-medium">
            1. Install the CLI
          </p>
          <CodeBlock>npm install -g @octp/cli</CodeBlock>
        </div>

        <div>
          <p className="text-muted-foreground mb-1.5 text-xs font-medium">
            2. Log in (opens browser to authorize)
          </p>
          <CodeBlock>octopus login</CodeBlock>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Or use an existing token:{" "}
            <code className="rounded bg-stone-100 px-1 py-0.5 dark:bg-stone-700">
              octopus login --token oct_...
            </code>
          </p>
        </div>

        <div>
          <p className="text-muted-foreground mb-1.5 text-xs font-medium">
            3. Verify your connection
          </p>
          <CodeBlock>octopus whoami</CodeBlock>
        </div>
      </div>

      <div className="border-t pt-4 dark:border-stone-700">
        <p className="text-muted-foreground mb-2.5 text-xs font-medium">
          Common Commands
        </p>
        <div className="space-y-2">
          <CodeBlock>{`# List your repositories
octopus repo list

# Index a repository for code search
octopus repo index

# Review a pull request
octopus pr review --pr <number>

# Chat with your codebase
octopus repo chat

# Add knowledge to your org
octopus knowledge add <file>

# Check your usage
octopus usage`}</CodeBlock>
        </div>
      </div>
    </div>
  );
}
