import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Ollama helper functions for the onboarding wizard.
 *
 * Two surfaces:
 *   - HTTP API (`/api/tags`, `/api/pull`) for talking to whatever Ollama
 *     the user pointed `ollamaBaseUrl` at — works for both localhost and
 *     remote installs.
 *   - Local shell (`ollama --version`, install scripts) only when the
 *     configured URL is a localhost variant — we'd never want to mutate
 *     a remote machine on the user's behalf.
 */

export type OllamaModel = {
  name: string; // "qwen2.5-coder:32b"
  sizeBytes: number;
  modifiedAt: string;
};

export type CuratedModel = {
  name: string;
  displayName: string;
  approxSizeGb: number;
  blurb: string;
};

/**
 * Curated picks the wizard shows when the user has no Ollama models
 * installed yet. Ordered best-first for coding work; sizes are the
 * Ollama download size at the time of writing (subject to drift).
 */
export const CURATED_MODELS: CuratedModel[] = [
  {
    name: "qwen2.5-coder:32b",
    displayName: "Qwen 2.5 Coder 32B",
    approxSizeGb: 20,
    blurb: "Best overall for code review. Needs ~24GB RAM.",
  },
  {
    name: "qwen2.5-coder:14b",
    displayName: "Qwen 2.5 Coder 14B",
    approxSizeGb: 9,
    blurb: "Great quality/speed balance. Runs on most laptops.",
  },
  {
    name: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    approxSizeGb: 4.7,
    blurb: "Fast, fits 8GB RAM Macs. Lower quality but usable.",
  },
  {
    name: "deepseek-coder-v2:16b",
    displayName: "DeepSeek Coder v2 16B",
    approxSizeGb: 9,
    blurb: "Strong alternative — different architecture, different bias.",
  },
  {
    name: "codestral:22b",
    displayName: "Codestral 22B (Mistral)",
    approxSizeGb: 13,
    blurb: "Mistral's coding model. Good multi-language support.",
  },
];

export function isLocalhostUrl(url: string): boolean {
  try {
    // `URL.hostname` keeps the brackets on IPv6 (`new URL("http://[::1]").hostname`
    // returns "[::1]"), so a bare `=== "::1"` check is dead. Strip brackets
    // before comparing — matches the same handling in
    // apps/cli/src/commands/review.ts:isLocalServer.
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Check whether the `ollama` CLI is on PATH. Returns false on Windows
 * (where `ollama` is typically an installer-launched service rather than
 * a CLI on PATH) so the wizard always shows the install instructions
 * there.
 */
export async function isOllamaInstalledLocally(): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    try {
      const child = spawn("ollama", ["--version"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/**
 * List models installed on the Ollama daemon at the given base URL.
 * Returns null when the daemon isn't reachable (likely not running or
 * the URL is wrong); empty array when reachable but no models pulled.
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[] | null> {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as {
      models?: { name: string; size?: number; modified_at?: string }[];
    };
    return (body.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      modifiedAt: m.modified_at ?? "",
    }));
  } catch {
    return null;
  }
}

/**
 * Platform-specific install command. Returned as a string the user can
 * copy + paste — never executed for them, since installing system
 * software without consent is too dangerous to do silently.
 */
export function installInstructionFor(): {
  platform: "darwin" | "linux" | "windows" | "other";
  command: string;
  alternativeUrl: string;
} {
  const p = platform();
  if (p === "darwin") {
    return {
      platform: "darwin",
      command: "brew install ollama",
      alternativeUrl: "https://ollama.com/download",
    };
  }
  if (p === "linux") {
    return {
      platform: "linux",
      command: "curl -fsSL https://ollama.com/install.sh | sh",
      alternativeUrl: "https://ollama.com/download",
    };
  }
  if (p === "win32") {
    return {
      platform: "windows",
      command: "winget install Ollama.Ollama",
      alternativeUrl: "https://ollama.com/download/windows",
    };
  }
  return {
    platform: "other",
    command: "See the download page for your OS",
    alternativeUrl: "https://ollama.com/download",
  };
}

/**
 * Pull a model via the Ollama HTTP API. Streams progress as ndjson;
 * `onProgress` receives each status update. Resolves when the pull
 * completes; rejects on network failure or non-success status.
 *
 * Caller MUST have already confirmed Ollama is reachable at `baseUrl` —
 * we don't pre-check here because the pull will surface its own clear
 * error if the daemon isn't running.
 */
export async function pullOllamaModel(
  baseUrl: string,
  model: string,
  onProgress: (update: PullProgress) => void,
): Promise<void> {
  const r = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });
  if (!r.ok || !r.body) {
    throw new Error(`pull failed: HTTP ${r.status}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // ndjson — split on newline, parse each complete line
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let update: PullProgress;
      try {
        update = JSON.parse(line) as PullProgress;
      } catch {
        // Tolerate the occasional malformed line (rare); move on. We must
        // not swallow `update.error` here — that's a real failure from the
        // daemon and gets thrown unconditionally below the parse.
        continue;
      }
      onProgress(update);
      if (update.error) throw new Error(update.error);
    }
  }
}

export type PullProgress = {
  status?: string; // "pulling manifest" | "downloading digestname" | "verifying sha256 digest" | "success"
  completed?: number;
  total?: number;
  error?: string;
};
