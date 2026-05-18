import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { setByokKey } from "../lib/byok.js";
import { hintFor } from "../lib/keys.js";

export type ByokStepProps = {
  provider: string;
  onNext: (patch: { byokSaved?: boolean }) => void;
};

type Mode = "intro" | "entering" | "saving" | "saved" | "failed" | "skipped";

/**
 * Collect an API key for the chosen provider. Two adornments:
 *   - masked TextInput so the key isn't echoed to the terminal
 *   - placeholder text + a one-line dashboard URL hint specific to the provider
 *
 * For keyless providers (Ollama, the agent harnesses when the user already
 * has their CLI authed), we offer a "skip" path up front rather than forcing
 * the user through a meaningless prompt.
 */
export function ByokStep({ provider, onNext }: ByokStepProps) {
  const hint = hintFor(provider);
  const [mode, setMode] = useState<Mode>(hint.keyless ? "intro" : "entering");
  const [value, setValue] = useState<string>("");
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
