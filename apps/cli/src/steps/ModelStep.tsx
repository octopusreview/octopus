import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { defaultModelFor, formatPrice, modelsFor } from "../lib/models.js";

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
  useInput((_input, key) => {
    if (key.escape) onNext({ model: "" });
  });

  const models = modelsFor(provider);

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
        <Text bold>No models seeded for "{provider}" yet</Text>
        <Text> </Text>
        <Text>This provider is coming soon. You can finish onboarding now;</Text>
        <Text>the model picker will populate once the backend ships.</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Continue without a model", value: "skip" },
            { label: "Go back to provider picker", value: "back" },
          ]}
          onSelect={(item) => {
            if (item.value === "skip") onNext({ model: "" });
            // "back" is handled by the wizard's Esc/back arrow — for now treat as skip.
            else onNext({ model: "" });
          }}
        />
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
      <Text bold>Pick a model for {provider}</Text>
      {def ? (
        <Text dimColor>
          Recommended: {def.displayName} ({formatPrice(def)})
        </Text>
      ) : null}
      <Text> </Text>
      <SelectInput items={items} onSelect={(item) => onNext({ model: item.value })} />
      <Text> </Text>
      <Text dimColor>Use ↑/↓ to move, Enter to select · Esc to skip</Text>
    </Box>
  );
}
