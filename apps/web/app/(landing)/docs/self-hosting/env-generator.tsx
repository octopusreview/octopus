"use client";

import { useState, useCallback } from "react";
import { IconCopy, IconCheck, IconRefresh } from "@tabler/icons-react";

function generateSecret(length = 64): string {
  const array = new Uint8Array(length / 2);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_ENV = {
  DATABASE_URL: "postgresql://octopus:octopus@localhost:5432/octopus",
  QDRANT_URL: "http://localhost:6333",
  BETTER_AUTH_URL: "http://localhost:3000",
};

export function EnvGenerator() {
  const [secret, setSecret] = useState(() => generateSecret());
  const [copied, setCopied] = useState(false);

  const envContent = `# Database (overridden by docker-compose when using Docker)
DATABASE_URL=${DEFAULT_ENV.DATABASE_URL}

# Qdrant (overridden by docker-compose when using Docker)
QDRANT_URL=${DEFAULT_ENV.QDRANT_URL}
QDRANT_API_KEY=

# Auth
BETTER_AUTH_SECRET=${secret}
BETTER_AUTH_URL=${DEFAULT_ENV.BETTER_AUTH_URL}

# AI Providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
NEXT_PUBLIC_GITHUB_APP_SLUG=

# Optional
COHERE_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=`;

  const regenerate = useCallback(() => {
    setSecret(generateSecret());
    setCopied(false);
  }, []);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(envContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [envContent]);

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-white/[0.06]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-4 py-2">
        <span className="text-xs text-[#666]">.env</span>
        <div className="flex items-center gap-2">
          <button
            onClick={regenerate}
            className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-xs text-[#888] transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconRefresh className="size-3" />
            Regenerate Secret
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 text-xs text-[#888] transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            {copied ? (
              <>
                <IconCheck className="size-3 text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <IconCopy className="size-3" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto bg-[#161616] px-4 py-3">
        <code className="text-sm leading-relaxed text-[#ccc]">{envContent}</code>
      </pre>
    </div>
  );
}
