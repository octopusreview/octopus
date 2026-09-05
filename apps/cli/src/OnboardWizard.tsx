import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, render } from "ink";
import { Header } from "./components/Header.js";
import { WelcomeStep } from "./steps/WelcomeStep.js";
import { AuthStep } from "./steps/AuthStep.js";
import { OrgStep } from "./steps/OrgStep.js";
import { ProviderStep } from "./steps/ProviderStep.js";
import { ModelStep } from "./steps/ModelStep.js";
import { ByokStep } from "./steps/ByokStep.js";
import { OllamaSetupStep } from "./steps/OllamaSetupStep.js";
import { ValidateStep } from "./steps/ValidateStep.js";
import { RepoStep } from "./steps/RepoStep.js";
import { DoneStep } from "./steps/DoneStep.js";
import { loadConfig, type OctopusConfig } from "./lib/config.js";
import { buildSequence } from "./lib/sequence.js";

/**
 * Linear wizard with conditional skips via useMemo<StepKey[]>. Each step is
 * a small component that calls `onNext(answers)` when the user advances; the
 * wizard owns the answer accumulator and the step index. Add a new step by
 * (1) adding a key to StepKey, (2) appending the component to the switch
 * below, and (3) including/excluding it in the sequence useMemo based on
 * environment (self-hosted vs Cloud, etc.).
 *
 * Full flow: Welcome → Auth → Org → Provider → Model → BYOK → Validate →
 * Repo → Done.
 *
 * When `reset` is true (invoked via `octp onboard --reset`) the wizard
 * pre-seeds answers from the saved config so the user only fixes what's
 * wrong instead of re-entering everything. Filesystem state (credentials,
 * byok) is preserved — only prefs are re-prompted.
 */
export type StepKey =
  | "welcome"
  | "auth"
  | "org"
  | "provider"
  | "model"
  | "byok"
  | "ollama-setup"
  | "validate"
  | "repo"
  | "done";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "welcome", label: "Welcome" },
  { key: "auth", label: "Sign in" },
  { key: "org", label: "Org" },
  { key: "provider", label: "Provider" },
  { key: "model", label: "Model" },
  { key: "byok", label: "Key" },
  { key: "ollama-setup", label: "Ollama" },
  { key: "validate", label: "Validate" },
  { key: "repo", label: "Repo" },
  { key: "done", label: "Done" },
];

export type OnboardWizardProps = {
  /** When true, pre-seed answers from the saved config. */
  reset?: boolean;
};

export function OnboardWizard({ reset = false }: OnboardWizardProps = {}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<OctopusConfig>>({});
  const [seeded, setSeeded] = useState(!reset); // skip the seed effect when not in --reset mode
  // Provider-shape tabs (Ollama vs the rest) only diverge AFTER the user
  // has passed through ProviderStep this session. Until then we don't
  // know what they actually want — `answers.provider` may be pre-seeded
  // from a prior --reset run, but pre-seeding shouldn't dictate the
  // header layout while they're still on Auth/Org. ProviderStep flips
  // this true as it advances.
  const [providerConfirmed, setProviderConfirmed] = useState(false);

  // Conditional sequence (see lib/sequence.ts). The provider-dependent
  // reshape only takes effect once ProviderStep has been passed this
  // session (`providerConfirmed`), so a --reset user still sees the full
  // sequence while on Sign in / Org.
  const sequence = useMemo<StepKey[]>(
    () =>
      buildSequence(
        STEPS.map((s) => s.key),
        { provider: answers.provider, model: answers.model, providerConfirmed },
      ),
    [answers.provider, answers.model, providerConfirmed],
  );

  // One-shot: load existing config and use as initial answers (--reset).
  useEffect(() => {
    if (seeded) return;
    (async () => {
      const existing = await loadConfig();
      const { version: _v, onboardedAt: _o, ...prefs } = existing;
      setAnswers(prefs);
      setSeeded(true);
    })();
  }, [seeded]);

  const activeKey = sequence[stepIndex];
  const headerSteps = useMemo(
    () => STEPS.filter((s) => sequence.includes(s.key)),
    [sequence],
  );

  // Stable identity: steps list `onNext` in effect deps (AuthStep's poll,
  // ByokStep's pass-through), so a new function per render would restart
  // them. Keys set to `undefined` in a patch are removed (Cloud clears a
  // seeded selfHostedBaseUrl this way).
  const sequenceLengthRef = React.useRef(sequence.length);
  sequenceLengthRef.current = sequence.length;

  const next = useCallback((patch: Partial<OctopusConfig> = {}) => {
    setAnswers((a) => {
      const merged: Partial<OctopusConfig> = { ...a, ...patch };
      for (const key of Object.keys(patch) as (keyof OctopusConfig)[]) {
        if (patch[key] === undefined) delete merged[key];
      }
      return merged;
    });
    setStepIndex((i) => Math.min(i + 1, sequenceLengthRef.current - 1));
  }, []);

  // Patch-less advance with a stable identity for steps whose patch is not
  // part of the saved prefs (Byok's byokSaved) or that send none.
  const advance = useCallback(() => next(), [next]);

  const isCloud = !answers.selfHostedBaseUrl;

  // Jump back to a specific step key. Used by OrgStep → Auth ("switch org")
  // and ValidateStep → BYOK ("edit key").
  const jumpTo = (key: StepKey) => {
    const idx = sequence.indexOf(key);
    if (idx >= 0) setStepIndex(idx);
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Header steps={headerSteps} activeKey={activeKey} />
      {activeKey === "welcome" && <WelcomeStep onNext={() => next()} />}
      {activeKey === "auth" && <AuthStep onNext={next} />}
      {activeKey === "org" && <OrgStep onNext={advance} onSwitchOrg={() => jumpTo("auth")} />}
      {activeKey === "provider" && (
        <ProviderStep
          isCloud={isCloud}
          onNext={(p) => {
            setProviderConfirmed(true);
            next(p);
          }}
        />
      )}
      {activeKey === "model" && (
        <ModelStep provider={answers.provider ?? ""} onNext={next} />
      )}
      {activeKey === "byok" && (
        <ByokStep provider={answers.provider ?? ""} onNext={advance} />
      )}
      {activeKey === "ollama-setup" && (
        <OllamaSetupStep
          ollamaBaseUrl={answers.ollamaBaseUrl}
          onNext={(p) => next(p)}
        />
      )}
      {activeKey === "validate" && (
        <ValidateStep
          provider={answers.provider ?? ""}
          onNext={advance}
          onEditKey={() => jumpTo("byok")}
        />
      )}
      {activeKey === "repo" && <RepoStep onNext={advance} />}
      {activeKey === "done" && <DoneStep answers={answers} />}
    </Box>
  );
}

/**
 * Render the wizard and resolve once the user exits it. Shared by the
 * `octp onboard` entry point and the chat `/onboard` slash command so both
 * launch the exact same component. Pass `reset` to pre-seed answers from the
 * saved config.
 */
export async function renderWizard(reset = false): Promise<void> {
  const { waitUntilExit } = render(<OnboardWizard reset={reset} />);
  await waitUntilExit();
}
