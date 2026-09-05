import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { defaultModelFor, formatPrice, modelsFor } from "../lib/models.js";
import { displayNameFor } from "../lib/providers.js";

export type ModelStepProps = {
  provider: string;
  onNext: (patch: { model: string }) => void;
};

/**
 * Pick a model from the chosen provider. The catalogue lives in
 * apps/cli/src/lib/models.ts and is hardcoded today (see note there
 * about the future /api/cli/models endpoint).
 *
 * Empty provider catalogues (the coming-soon ones) render a friendly
 * "no models yet" panel and allow the user to skip or proceed with an
 * empty model — DoneStep handles the unset case downstream.
 */
export function ModelStep({ provider, onNext }: ModelStepProps) {
  // The no-provider panel below tells the user "Press Enter to continue",
  // so handle Enter (in addition to Esc) when there's no provider. Without
  // this, Enter does nothing on that screen and the user is soft-locked
  // on a step whose own instructions are wrong.
  const models = modelsFor(provider);

  useInput((_input, key) => {
    if (key.escape) onNext({ model: "" });
    if (key.return && (!provider || models.length === 0)) onNext({ model: "" });
  });

  if (!provider) {
    return (
      <Box flexDirection="column">
        <Text>No provider selected — nothing to pick.</Text>
        <Text dimColor>Press Enter to continue.</Text>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>No models listed for {displayNameFor(provider)}</Text>
        <Text> </Text>
        <Text>You can finish onboarding now and pick a model later in Settings.</Text>
        <Text> </Text>
        <Text dimColor>Press Enter to continue.</Text>
      </Box>
    );
  }

  const def = defaultModelFor(provider);
  const items = models.map((m) => {
    const suffix = m.isDefault ? "  (recommended)" : "";
    return {
      label: `${m.displayName.padEnd(28, " ")}  ${formatPrice(m)}${suffix}`,
      value: m.modelId,
    };
  });

  return (
    <Box flexDirection="column">
      <Text bold>Pick a model for {displayNameFor(provider)}</Text>
      {def ? (
        <Text dimColor>
          Recommended: {def.displayName} ({formatPrice(def)})
        </Text>
      ) : null}
      <Text> </Text>
      <SelectInput
        items={items}
        initialIndex={Math.max(0, items.findIndex((i) => i.value === def?.modelId))}
        onSelect={(item) => onNext({ model: item.value })}
      />
      <Text> </Text>
      <Text dimColor>Use ↑/↓ to move, Enter to select · Esc to skip</Text>
    </Box>
  );
}
