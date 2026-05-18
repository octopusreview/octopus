import React from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { PROVIDERS, type ProviderInfo } from "../lib/providers.js";

export type ProviderStepProps = {
  onNext: (patch: { provider: string }) => void;
};

const TYPE_ORDER: ProviderInfo["type"][] = ["direct", "harness", "gateway", "local"];
const TYPE_LABEL: Record<ProviderInfo["type"], string> = {
  direct: "Direct API",
  harness: "Agent harnesses",
  gateway: "Gateways",
  local: "Local",
};

/**
 * Render the catalogue as a single SelectInput with type labels as
 * non-selectable separators. ink-select-input does not support headers,
 * so we use disabled items with a leading dash convention; the selector
 * skips them via the `isItemSelectable` we wrap around the items list.
 *
 * Coming-soon providers are still shown (so users see what's planned)
 * but disabled — selecting them moves on with a one-line note that
 * onboarding completes but reviews won't run until the backend lands.
 */
export function ProviderStep({ onNext }: ProviderStepProps) {
  useInput((_input, key) => {
    if (key.escape) onNext({ provider: "" }); // skip — onboarding finishes without a provider
  });

  // Build a flat list with type headings interleaved. Headings are inert
  // (selecting one is a no-op handled in onSelect).
  type Item = { label: string; value: string; isHeading?: boolean; disabled?: boolean };
  const items: Item[] = [];
  for (const type of TYPE_ORDER) {
    const inType = PROVIDERS.filter((p) => p.type === type);
    if (inType.length === 0) continue;
    items.push({ label: `── ${TYPE_LABEL[type]} ──`, value: `__heading_${type}`, isHeading: true });
    for (const p of inType) {
      const suffix = p.status === "coming-soon" ? " (coming soon)" : "";
      items.push({
        label: `  ${p.displayName}${suffix}`,
        value: p.slug,
        disabled: p.status === "coming-soon",
      });
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold>Pick an AI provider</Text>
      <Text dimColor>The provider runs your code reviews. You can change this later.</Text>
      <Text> </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value.startsWith("__heading_")) return; // ignore
          onNext({ provider: item.value });
        }}
      />
      <Text> </Text>
      <Text dimColor>Use ↑/↓ to move, Enter to select · Esc to skip</Text>
    </Box>
  );
}
