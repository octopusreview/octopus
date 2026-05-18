import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { setByokKey } from "../lib/byok.js";
import { hintFor } from "../lib/keys.js";
import { DEFAULT_OLLAMA_BASE_URL } from "../lib/config.js";

export type ByokStepProps = {
  provider: string;
  /** Pre-existing ollama URL from a prior wizard run (passed when --reset). */
  ollamaBaseUrl?: string;
  onNext: (patch: { byokSaved?: boolean; ollamaBaseUrl?: string }) => void;
};

type Mode =
  | "intro"
  | "entering"
  | "saving"
  | "saved"
  | "failed"
  | "skipped"
  | "ollama-url"; // Special pre-filled URL input for ollama

/**
 * Collect an API key for the chosen provider. Two adornments:
 *   - masked TextInput so the key isn't echoed to the terminal
 *   - placeholder text + a one-line dashboard URL hint specific to the provider
 *
 * For keyless providers (Ollama, the agent harnesses when the user already
 * has their CLI authed), we offer a "skip" path up front rather than forcing
 * the user through a meaningless prompt.
 */
export function ByokStep({ provider, ollamaBaseUrl, onNext }: ByokStepProps) {
  const hint = hintFor(provider);
  const isOllama = provider === "ollama";
  // For ollama, go straight to URL entry (pre-filled). Other keyless providers
  // see the intro/skip picker as before. Keyed providers go to `entering`.
  const initialMode: Mode = isOllama
    ? "ollama-url"
    : hint.keyless
      ? "intro"
      : "entering";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState<string>(
    isOllama ? ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL : "",
  );
  const [error, setError] = useState<string>("");

  useInput((_input, key) => {
    if (key.escape && mode !== "saving" && mode !== "saved") {
      setMode("skipped");
      onNext({ byokSaved: false });
    }
  });

  // No provider selected (the user skipped ProviderStep) — pass through.
  if (!provider) {
    onNext({ byokSaved: false });
    return null;
  }

  if (mode === "ollama-url") {
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
          value={value}
          onChange={setValue}
          onSubmit={(submitted) => {
            const url = submitted.trim() || DEFAULT_OLLAMA_BASE_URL;
            try {
              const parsed = new URL(url);
              if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                setError(`URL must be http(s); got ${parsed.protocol}`);
                return;
              }
            } catch {
              setError(`Not a parseable URL: ${url.slice(0, 60)}`);
              return;
            }
            setError("");
            // Persist the URL on the patch so OnboardWizard saves it to
            // ~/.octopus/config.json. Only emit if it differs from the
            // default — keeps the config file minimal for the common case.
            const patch =
              url === DEFAULT_OLLAMA_BASE_URL
                ? { byokSaved: false }
                : { byokSaved: false, ollamaBaseUrl: url };
            onNext(patch);
          }}
        />
        {error ? <Text color="red">{error}</Text> : null}
        <Text> </Text>
        <Text dimColor>Enter: save · Esc: skip (use default)</Text>
      </Box>
    );
  }

  if (mode === "intro") {
    return (
      <Box flexDirection="column">
        <Text bold>API key for {provider}</Text>
        <Text dimColor>{hint.placeholder}</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "I want to enter an API key", value: "enter" },
            { label: "Skip — I'm using subscription / CLI / local mode", value: "skip" },
          ]}
          onSelect={(item) => {
            if (item.value === "enter") setMode("entering");
            else {
              setMode("skipped");
              onNext({ byokSaved: false });
            }
          }}
        />
      </Box>
    );
  }

  if (mode === "entering") {
    return (
      <Box flexDirection="column">
        <Text bold>API key for {provider}</Text>
        {hint.dashboardUrl ? (
          <Text dimColor>Get one at <Text color="cyan">{hint.dashboardUrl}</Text></Text>
        ) : null}
        <Text> </Text>
        <Text>Key: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder={hint.placeholder}
          mask="*"
          onSubmit={async (submitted) => {
            const trimmed = submitted.trim();
            if (trimmed.length < hint.minLength) {
              setError(
                hint.minLength === 0
                  ? "Key cannot be empty."
                  : `Key looks too short (need at least ${hint.minLength} characters).`,
              );
              return;
            }
            setError("");
            setMode("saving");
            try {
              await setByokKey(provider, trimmed);
              setMode("saved");
              setTimeout(() => onNext({ byokSaved: true }), 500);
            } catch (e) {
              setError(`Could not save key: ${e instanceof Error ? e.message : String(e)}`);
              setMode("failed");
            }
          }}
        />
        {error ? <Text color="red">{error}</Text> : null}
        <Text> </Text>
        <Text dimColor>Enter to save · Esc to skip (use platform key instead)</Text>
      </Box>
    );
  }

  if (mode === "saving") {
    return (
      <Box flexDirection="column">
        <Text>Saving key to ~/.octopus/byok.json …</Text>
      </Box>
    );
  }

  if (mode === "saved") {
    return (
      <Box flexDirection="column">
        <Text color="green">Key saved.</Text>
      </Box>
    );
  }

  if (mode === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Save failed.</Text>
        <Text color="red">{error}</Text>
        <Text dimColor>Esc to skip.</Text>
      </Box>
    );
  }

  return null; // skipped — already advanced
}
