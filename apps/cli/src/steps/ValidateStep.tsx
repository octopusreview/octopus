import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { validateProvider, type ValidateResult } from "../lib/validate.js";

export type ValidateStepProps = {
  provider: string;
  onNext: () => void;
  /** Wizard sends the user back here when they want to edit their key. */
  onEditKey: () => void;
};

type Phase = "validating" | "ok" | "failed" | "skipped";

/**
 * Live API ping to confirm the BYOK key works (or that Ollama is reachable).
 * Each provider has a cheapest-possible check defined in lib/validate.ts.
 *
 * Phases:
 *   validating → fetch is in flight
 *   ok         → green check, brief pause, auto-advance
 *   skipped    → provider has no validator yet; render a note + advance
 *   failed     → red error + SelectInput: retry / edit-key / skip
 */
export function ValidateStep({ provider, onNext, onEditKey }: ValidateStepProps) {
  const [phase, setPhase] = useState<Phase>("validating");
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useInput((_input, key) => {
    if (key.escape && phase !== "validating" && phase !== "ok") onNext();
  });

  useEffect(() => {
    if (!provider) {
      onNext();
      return;
    }
    let cancelled = false;
    (async () => {
      setPhase("validating");
      const r = await validateProvider(provider);
      if (cancelled) return;
      setResult(r);
      if (r.ok === true) {
        setPhase("ok");
        setTimeout(onNext, 600);
      } else if (r.ok === "skipped") {
        setPhase("skipped");
        setTimeout(onNext, 1200);
      } else {
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, attempt, onNext]);

  if (!provider) return null;

  if (phase === "validating") {
    return (
      <Box flexDirection="column">
        <Text>Validating {provider} credentials …</Text>
      </Box>
    );
  }

  if (phase === "ok" && result?.ok === true) {
    return (
      <Box flexDirection="column">
        <Text color="green">
          ✓ {provider} reachable
          {typeof result.modelCount === "number"
            ? ` — ${result.modelCount} model${result.modelCount === 1 ? "" : "s"} available.`
            : "."}
        </Text>
      </Box>
    );
  }

  if (phase === "skipped" && result?.ok === "skipped") {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠ Skipping validation</Text>
        <Text dimColor>{result.reason}</Text>
      </Box>
    );
  }

  if (phase === "failed" && result && result.ok === false) {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Validation failed{result.status ? ` (HTTP ${result.status})` : ""}.</Text>
        <Text color="red">{result.message}</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Retry", value: "retry" },
            { label: "Edit the API key", value: "edit" },
            { label: "Skip — continue anyway", value: "skip" },
          ]}
          onSelect={(item) => {
            if (item.value === "retry") setAttempt((a) => a + 1);
            else if (item.value === "edit") onEditKey();
            else onNext();
          }}
        />
      </Box>
    );
  }

  return null;
}
