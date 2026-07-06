"use client";

import { useState, useTransition } from "react";
import { createServiceToken, revokeServiceToken } from "./actions";

type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
};

export function TokensClient({
  tokens,
  allScopes,
}: {
  tokens: TokenRow[];
  allScopes: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null); // reveal-once plaintext
  const [copied, setCopied] = useState(false);

  function onCreate(formData: FormData) {
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const res = await createServiceToken(formData);
      if (res.ok) setCreated(res.token);
      else setError(res.error);
    });
  }

  function onRevoke(id: string) {
    if (!confirm("Revoke this token? Apps using it will immediately lose access.")) return;
    startTransition(async () => {
      await revokeServiceToken(id);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-[#ddd]">
      <h1 className="text-2xl font-bold text-white">Service Tokens</h1>
      <p className="mt-2 text-sm text-[#888]">
        Scoped tokens for external apps (Claude, MCP, other integrations). Grant the
        least privilege each app needs.
      </p>

      {/* Reveal-once banner */}
      {created && (
        <div className="mt-6 rounded-lg border border-[#10D8BE]/40 bg-[#10D8BE]/[0.06] p-4">
          <p className="text-sm font-medium text-[#10D8BE]">
            Copy this token now — it is shown only once and cannot be retrieved again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-black/40 px-3 py-2 font-mono text-xs text-white">
              {created}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(created).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="shrink-0 rounded border border-white/15 px-3 py-2 text-xs text-white hover:bg-white/10"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <form action={onCreate} className="mt-8 rounded-lg border border-white/[0.08] p-5">
        <h2 className="font-semibold text-white">Create a token</h2>
        <label className="mt-4 block text-sm text-[#aaa]">
          Name
          <input
            name="name"
            required
            placeholder="e.g. Claude blog writer"
            className="mt-1 w-full rounded border border-white/[0.1] bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#10D8BE]/50"
          />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm text-[#aaa]">Scopes</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {allScopes.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-[#ccc]">
                <input type="checkbox" name="scopes" value={scope} className="accent-[#10D8BE]" />
                <code className="font-mono text-xs">{scope}</code>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-5 rounded-full bg-[#10D8BE] px-5 py-2 text-sm font-medium text-[#0c0c0c] disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>

      {/* Existing tokens */}
      <h2 className="mt-10 font-semibold text-white">Active tokens</h2>
      {tokens.length === 0 ? (
        <p className="mt-2 text-sm text-[#666]">No tokens yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="font-medium text-white">{t.name}</div>
                <code className="font-mono text-xs text-[#777]">{t.tokenPrefix}</code>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.scopes.map((s) => (
                    <span key={s} className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-[#aaa]">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-[#555]">
                  {t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "Never used"}
                  {" · "}created {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRevoke(t.id)}
                disabled={pending}
                className="shrink-0 rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
