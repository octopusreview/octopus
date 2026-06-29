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
    // Track the auto-advance timer so we can clear it on unmount. Without
    // this, an Esc during the 1.2s "skipped" window (or the 600ms "ok"
    // window) calls onNext immediately, then the un-cleared timer fires
    // after unmount and calls onNext a second time — stepIndex advances
    // twice, jumping past RepoStep to Done without the user seeing it.
    let autoAdvance: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      setPhase("validating");
      const r = await validateProvider(provider);
      if (cancelled) return;
      setResult(r);
      if (r.ok === true) {
        setPhase("ok");
        autoAdvance = setTimeout(onNext, 600);
      } else if (r.ok === "skipped") {
        setPhase("skipped");
        autoAdvance = setTimeout(onNext, 1200);
      } else {
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
      if (autoAdvance !== null) clearTimeout(autoAdvance);
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
    // Strip ANSI / OSC escapes from `result.message` before rendering —
    // it can contain raw response bodies from arbitrary remote endpoints
    // (the user's self-hosted URL or BYOK provider), and a malicious or
    // misconfigured remote could otherwise inject cursor movement /
    // terminal-title-rewrite / hyperlink sequences into the wizard's
    // output. \x1b is the ESC byte; the broad alternation covers CSI,
    // OSC, and other introducers.
    const safeMessage = result.message?.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[A-Za-z=>]/g,
      "",
    );
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Validation failed{result.status ? ` (HTTP ${result.status})` : ""}.</Text>
        <Text color="red">{safeMessage}</Text>
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
