import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { loadConfig, saveConfig, type OctopusConfig } from "../lib/config.js";
import { loadCredentials } from "../lib/credentials.js";
import { loadByok } from "../lib/byok.js";

export type DoneStepProps = {
  answers: Partial<OctopusConfig>;
};

type Phase = "saving" | "done" | "failed";
type Summary = {
  baseUrl?: string;
  orgName?: string;
  provider?: string;
  model?: string;
  byokSaved?: boolean;
  ollamaBaseUrl?: string;
};

/**
 * Final step: persists the accumulated answers, then renders a per-section
 * summary of what was configured so the user can see at a glance what's set
 * up and what was skipped. Save happens in a useEffect on mount; the screen
 * reflects the phase so a filesystem failure surfaces inline rather than
 * crashing the wizard.
 */
export function DoneStep({ answers }: DoneStepProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("saving");
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<Summary>({});

  useEffect(() => {
    (async () => {
      try {
        const current = await loadConfig();
        await saveConfig({ ...current, ...answers });

        // Build the summary from the persisted state — covers fields filled by
        // earlier steps (auth wrote credentials; byok wrote keys; etc.).
        const [creds, byok] = await Promise.all([loadCredentials(), loadByok()]);
        setSummary({
          baseUrl: creds?.baseUrl,
          orgName: creds?.orgName,
          provider: answers.provider,
          model: answers.model,
          byokSaved: answers.provider ? Boolean(byok.keys[answers.provider]) : false,
          ollamaBaseUrl: answers.ollamaBaseUrl,
        });

        setPhase("done");
        // Give the user a beat to see the success line before exiting.
        setTimeout(exit, 1500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("failed");
      }
    })();
  }, [answers, exit]);

  if (phase === "saving") {
    return (
      <Box flexDirection="column">
        <Text>Saving preferences…</Text>
      </Box>
    );
  }

  if (phase === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Could not save preferences:</Text>
        <Text color="red">{error}</Text>
        <Text> </Text>
        <Text dimColor>Check that ~/.octopus is writable, then re-run the wizard.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green" bold>You're set 🐙</Text>
      <Text> </Text>
      <Text bold>Summary</Text>
      <Text>  Server:   {summary.baseUrl ? <Text color="cyan">{summary.baseUrl}</Text> : <Text dimColor>not signed in</Text>}</Text>
      <Text>  Org:      {summary.orgName ?? <Text dimColor>—</Text>}</Text>
      <Text>  Provider: {summary.provider ?? <Text dimColor>not chosen</Text>}</Text>
      {summary.provider === "ollama" ? (
        <Text>  Model:    <Text dimColor>chosen per-repo from whatever you&apos;ve `ollama pull`ed</Text></Text>
      ) : (
        <Text>  Model:    {summary.model ?? <Text dimColor>not chosen</Text>}</Text>
      )}
      <Text>  BYOK key: {summary.byokSaved ? <Text color="green">saved</Text> : <Text dimColor>none</Text>}</Text>
      {summary.provider === "ollama" ? (
        <Text>  Ollama URL: <Text color="cyan">{summary.ollamaBaseUrl ?? "http://localhost:11434 (default)"}</Text></Text>
      ) : null}
      <Text> </Text>
      <Text bold>Next steps</Text>
      <Text>  • Open a pull request — Octopus will review it automatically.</Text>
      <Text>  • Run <Text color="cyan">octp review &lt;PR&gt;</Text> to trigger a review on demand.</Text>
      <Text>  • Re-run this wizard any time with <Text color="cyan">octp onboard --reset</Text>.</Text>
    </Box>
  );
}
