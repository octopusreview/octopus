import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { getJson } from "../lib/api.js";
import { loadCredentials } from "../lib/credentials.js";
import { defaultModelFor } from "../lib/models.js";
import { PROVIDERS, buildProviderItems, defaultProvider } from "../lib/providers.js";

export type ProviderStepProps = {
  onNext: (patch: { provider: string; model?: string }) => void;
  /** Cloud (Octopus hosted) vs a self-hosted instance; decided in the sign-in step. */
  isCloud: boolean;
};

type OrgModel = { provider: string; model: string; displayName: string | null; isPlatformDefault: boolean };

/**
 * Review model step.
 *
 * On Cloud the org's review model is a server-side setting; the provider and
 * model picked here only override local `octp review` runs. So the first
 * screen offers the org default (Enter) and a local override as the second
 * choice. Self-hosted users get the recommended provider/model pair first.
 * The full picker lists ready providers only; Ollama (local) is hidden on
 * Cloud because Cloud reviews run on Octopus servers.
 */
export function ProviderStep({ onNext, isCloud }: ProviderStepProps) {
  const [showAll, setShowAll] = useState(false);
  const [orgModel, setOrgModel] = useState<OrgModel | null>(null);

  useInput((_input, key) => {
    if (key.escape) onNext({ provider: "" }); // org default / skip
  });

  // Display-only: name the org's current review model when the server can
  // tell us. Any failure (older server without the route, offline, timeout)
  // leaves the screen unchanged.
  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;
    (async () => {
      const creds = await loadCredentials();
      if (!creds || cancelled) return;
      const res = await getJson<OrgModel>(`${creds.baseUrl}/api/cli/models`, {
        headers: { Authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!cancelled && res.ok && res.data?.model) setOrgModel(res.data);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCloud]);

  const recommended = defaultProvider();
  const recommendedModel = recommended ? defaultModelFor(recommended.slug) : null;

  if (!showAll && isCloud) {
    const current = orgModel?.displayName ?? orgModel?.model;
    return (
      <Box flexDirection="column">
        <Text bold>Review model</Text>
        <Text dimColor>
          Reviews on Cloud use your org's default model{current ? `: ${current}` : ""}. A change here
          only overrides local "octp review" runs.
        </Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Use org default (recommended)", value: "default" },
            { label: "Set a local override (choose provider and model)", value: "override" },
          ]}
          onSelect={(item) => {
            if (item.value === "default") onNext({ provider: "" });
            else setShowAll(true);
          }}
        />
        <Text> </Text>
        <Text dimColor>Enter to continue · Esc to skip</Text>
      </Box>
    );
  }

  if (!showAll && recommended && recommendedModel) {
    return (
      <Box flexDirection="column">
        <Text bold>Review model</Text>
        <Text dimColor>The provider runs your code reviews. You can change this later.</Text>
        <Text> </Text>
        <SelectInput
          items={[
            {
              label: `Use recommended: ${recommended.displayName} / ${recommendedModel.displayName}`,
              value: "recommended",
            },
            { label: "Choose a different provider", value: "choose" },
          ]}
          onSelect={(item) => {
            if (item.value === "recommended") {
              onNext({ provider: recommended.slug, model: recommendedModel.modelId });
            } else {
              setShowAll(true);
            }
          }}
        />
        <Text> </Text>
        <Text dimColor>Enter to continue · Esc to skip</Text>
      </Box>
    );
  }

  const items = buildProviderItems(PROVIDERS, { cloud: isCloud });

  return (
    <Box flexDirection="column">
      <Text bold>Pick an AI provider</Text>
      <Text dimColor>
        {isCloud
          ? "Overrides the model for local \"octp review\" runs only. Cloud PR reviews keep the org default."
          : "The provider runs your code reviews. You can change this later."}
      </Text>
      <Text> </Text>
      <SelectInput items={items} onSelect={(item) => onNext({ provider: item.value })} />
      <Text> </Text>
      <Text dimColor>Use ↑/↓ to move, Enter to select · Esc to skip</Text>
    </Box>
  );
}
