import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import {
  CURATED_MODELS,
  installInstructionFor,
  isLocalhostUrl,
  isOllamaInstalledLocally,
  listOllamaModels,
  pullOllamaModel,
  type OllamaModel,
  type PullProgress,
} from "../lib/ollama.js";
import { DEFAULT_OLLAMA_BASE_URL } from "../lib/config.js";

export type OllamaSetupStepProps = {
  ollamaBaseUrl?: string;
  onNext: (patch: { model?: string; ollamaBaseUrl?: string }) => void;
};

type Phase =
  | "url-input" // first: ask for the URL, pre-filled to localhost:11434
  | "probing" // checking install + querying /api/tags
  | "remote-empty" // remote URL, no models — can't pull for them
  | "remote-pick" // remote URL, models exist
  | "local-not-installed" // localhost URL, ollama not on PATH
  | "local-not-running" // localhost URL, installed but daemon down
  | "local-empty" // localhost URL, running, no models — offer curated picks
  | "local-pick" // localhost URL, running, models exist
  | "pulling" // pulling a curated model
  | "done"; // emit to onNext

/**
 * Ollama-specific setup phase. Runs only when provider === "ollama"
 * (gated in OnboardWizard's sequence).
 *
 * Detection matrix:
 *
 *                    | reachable + models  | reachable + empty | unreachable
 *   ----------------- + ------------------- + ----------------- + -----------
 *   localhost URL    | pick from existing  | offer top-5 pull  | install/start
 *   remote URL       | pick from existing  | "no models there" | "unreachable"
 *
 * We never install Ollama for the user — that needs sudo on Linux and
 * is invasive — but we DO offer to `ollama pull <model>` via the HTTP
 * API when the daemon is up locally, since that's a download into
 * user-owned space.
 *
 * The user can Esc to skip at any time. If skipped, the wizard proceeds
 * without a model preference — they can configure it later via the web
 * UI at /settings/models.
 */
export function OllamaSetupStep({ ollamaBaseUrl, onNext }: OllamaSetupStepProps) {
  // baseUrl is now mutable state: starts at the wizard-prop / default, the
  // user can edit it in `url-input`, and edits also bring us back to this
  // phase from any of the not-reachable terminals (so they can fix a typo
  // without restarting onboarding).
  const [baseUrl, setBaseUrl] = useState<string>(ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL);
  const [urlInputValue, setUrlInputValue] = useState<string>(
    ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL,
  );
  const isLocal = isLocalhostUrl(baseUrl);

  const [phase, setPhase] = useState<Phase>("url-input");
  const [installedModels, setInstalledModels] = useState<OllamaModel[]>([]);
  const [pullingModel, setPullingModel] = useState<string>("");
  const [pullStatus, setPullStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [urlInputError, setUrlInputError] = useState<string>("");

  // Esc → skip at any non-pulling phase. We don't allow interrupting a
  // pull mid-stream because the partial layers stay on disk and re-runs
  // resume cleanly anyway — no destructive state.
  // From any of the "not reachable" / "not installed" phases, `b`/backspace
  // jumps back to the URL input so the user can fix a typo without restarting.
  useInput((input, key) => {
    if (key.escape && phase !== "pulling" && phase !== "done") {
      // Still emit the URL on skip if the user explicitly changed it from
      // the default — losing their typing would be surprising. emitPatch
      // suppresses it for the default case so the config file stays clean.
      emitPatch({});
    }
    if (
      (phase === "local-not-installed" ||
        phase === "local-not-running" ||
        phase === "remote-empty") &&
      (input === "b" || input === "B" || key.backspace || key.delete)
    ) {
      setError("");
      setUrlInputError("");
      setPhase("url-input");
    }
  });

  // Probe whenever we (re-)enter "probing". List models, derive phase.
  useEffect(() => {
    if (phase !== "probing") return;
    let cancelled = false;
    (async () => {
      const models = await listOllamaModels(baseUrl);
      if (cancelled) return;
      if (models === null) {
        if (isLocal) {
          const installed = await isOllamaInstalledLocally();
          if (cancelled) return;
          setPhase(installed ? "local-not-running" : "local-not-installed");
        } else {
          setPhase("remote-empty");
          setError(`Couldn't reach Ollama at ${baseUrl}.`);
        }
        return;
      }
      setInstalledModels(models);
      if (models.length === 0) {
        setPhase(isLocal ? "local-empty" : "remote-empty");
      } else {
        setPhase(isLocal ? "local-pick" : "remote-pick");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, baseUrl, isLocal]);

  function submitUrl(submitted: string) {
    const url = submitted.trim() || DEFAULT_OLLAMA_BASE_URL;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setUrlInputError(`URL must be http(s); got ${parsed.protocol}`);
        return;
      }
    } catch {
      setUrlInputError(`Not a parseable URL: ${url.slice(0, 60)}`);
      return;
    }
    setUrlInputError("");
    setBaseUrl(url);
    setUrlInputValue(url);
    setPhase("probing");
  }

  // Emit the URL on patch when (and only when) it differs from the default,
  // so the saved config stays minimal for the common case.
  function emitPatch(patch: { model?: string }) {
    const ollamaPatch =
      baseUrl !== DEFAULT_OLLAMA_BASE_URL ? { ollamaBaseUrl: baseUrl } : {};
    onNext({ ...patch, ...ollamaPatch });
  }

  // ── Render phases ──────────────────────────────────────────────────────────

  if (phase === "url-input") {
    return (
      <Box flexDirection="column">
        <Text bold>Ollama base URL</Text>
        <Text dimColor>
          Default is <Text color="cyan">{DEFAULT_OLLAMA_BASE_URL}</Text>. Change
          only if your Ollama daemon runs on a different host or port.
        </Text>
        <Text> </Text>
        <Text>URL: </Text>
        <TextInput
          value={urlInputValue}
          onChange={setUrlInputValue}
          onSubmit={submitUrl}
        />
        {urlInputError ? <Text color="red">{urlInputError}</Text> : null}
        <Text> </Text>
        <Text dimColor>Enter: continue · Esc: skip</Text>
      </Box>
    );
  }

  if (phase === "probing") {
    return (
      <Box flexDirection="column">
        <Text bold>Checking Ollama at <Text color="cyan">{baseUrl}</Text>…</Text>
        <Text dimColor>Listing installed models. This should take a second.</Text>
      </Box>
    );
  }

  if (phase === "local-not-installed") {
    const inst = installInstructionFor();
    return (
      <Box flexDirection="column">
        <Text bold>Ollama isn&apos;t installed on this machine.</Text>
        <Text> </Text>
        <Text>Install it ({inst.platform}):</Text>
        <Text color="cyan">  {inst.command}</Text>
        <Text dimColor>Or download: <Text color="cyan">{inst.alternativeUrl}</Text></Text>
        <Text> </Text>
        <Text>
          Once installed, start the daemon with <Text color="cyan">ollama serve</Text>.
        </Text>
        <Text> </Text>
        <Text dimColor>B: edit URL · Esc: skip — configure later from /settings/models</Text>
      </Box>
    );
  }

  if (phase === "local-not-running") {
    return (
      <Box flexDirection="column">
        <Text bold>Ollama is installed but not running.</Text>
        <Text> </Text>
        <Text>Start the daemon in another terminal:</Text>
        <Text color="cyan">  ollama serve</Text>
        <Text> </Text>
        <Text dimColor>B: edit URL · Esc: skip — configure later</Text>
      </Box>
    );
  }

  if (phase === "remote-empty") {
    return (
      <Box flexDirection="column">
        <Text bold>
          {error
            ? `Ollama is unreachable at ${baseUrl}.`
            : `No models installed on the Ollama at ${baseUrl}.`}
        </Text>
        <Text> </Text>
        <Text dimColor>
          That host is remote — we can&apos;t install or pull models on
          your behalf. Pull a model there with{" "}
          <Text color="cyan">ollama pull qwen2.5-coder:32b</Text> (or similar).
        </Text>
        <Text> </Text>
        <Text dimColor>B: edit URL · Esc: skip — configure later</Text>
      </Box>
    );
  }

  if (phase === "local-empty") {
    return (
      <Box flexDirection="column">
        <Text bold>Ollama is running but you don&apos;t have any models yet.</Text>
        <Text dimColor>Pick one to download. Sizes are approximate.</Text>
        {error ? (
          <>
            <Text> </Text>
            <Text color="red">{error}</Text>
          </>
        ) : null}
        <Text> </Text>
        <SelectInput
          items={[
            ...CURATED_MODELS.map((m) => ({
              label: `${m.displayName.padEnd(28)} ~${m.approxSizeGb} GB · ${m.blurb}`,
              value: m.name,
            })),
            { label: "Skip — I'll pull one myself later", value: "__skip__" },
          ]}
          onSelect={(item) => {
            if (item.value === "__skip__") {
              emitPatch({});
              return;
            }
            void runPull(item.value);
          }}
        />
        <Text> </Text>
        <Text dimColor>Esc: skip</Text>
      </Box>
    );
  }

  if (phase === "local-pick" || phase === "remote-pick") {
    return (
      <Box flexDirection="column">
        <Text bold>
          {installedModels.length === 1
            ? `Found 1 model on ${baseUrl}.`
            : `Found ${installedModels.length} models on ${baseUrl}.`}
        </Text>
        <Text dimColor>Pick the default for new repos. You can change per-repo later.</Text>
        <Text> </Text>
        <SelectInput
          items={[
            ...installedModels.map((m) => ({
              label: `${m.name.padEnd(38)} ${m.sizeBytes > 0 ? (m.sizeBytes / 1e9).toFixed(1) + " GB" : ""}`,
              value: m.name,
            })),
            { label: "Skip — pick per-repo later", value: "__skip__" },
          ]}
          onSelect={(item) => {
            if (item.value === "__skip__") {
              emitPatch({});
              return;
            }
            // model id stored in OctopusConfig is `ollama:<name>` so
            // ai-router's prefix fallback routes through ollamaProvider.
            emitPatch({ model: `ollama:${item.value}` });
          }}
        />
        <Text> </Text>
        <Text dimColor>Esc: skip</Text>
      </Box>
    );
  }

  if (phase === "pulling") {
    return (
      <Box flexDirection="column">
        <Text bold>Pulling <Text color="cyan">{pullingModel}</Text>…</Text>
        <Text dimColor>{pullStatus || "Starting…"}</Text>
        <Text> </Text>
        <Text dimColor>
          This downloads the model into Ollama&apos;s store. Safe to wait;
          partial downloads resume on re-run.
        </Text>
        {error ? <Text color="red">{error}</Text> : null}
      </Box>
    );
  }

  return null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function runPull(modelName: string) {
    setPullingModel(modelName);
    setPullStatus("");
    setError("");
    setPhase("pulling");
    try {
      let lastEmittedAt = 0;
      await pullOllamaModel(baseUrl, modelName, (update: PullProgress) => {
        // Rate-limit re-renders to ~4/sec — bytes flow much faster than that
        // and re-rendering ink on every chunk causes flicker.
        const now = Date.now();
        if (now - lastEmittedAt < 250 && update.status !== "success") return;
        lastEmittedAt = now;
        if (update.total && update.completed != null) {
          const pct = Math.floor((update.completed / update.total) * 100);
          setPullStatus(`${update.status ?? "downloading"} — ${pct}%`);
        } else if (update.status) {
          setPullStatus(update.status);
        }
      });
      emitPatch({ model: `ollama:${modelName}` });
    } catch (e) {
      setError(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
      // Drop back to the picker so the user can either pick a different
      // model or Esc to skip — the previous "stay on pulling" trapped
      // them because the Esc handler short-circuits while phase==="pulling".
      setPhase(isLocal ? "local-empty" : "remote-empty");
    }
  }
}
