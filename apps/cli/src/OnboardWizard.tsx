import React, { useEffect, useMemo, useState } from "react";
import { Box } from "ink";
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

/**
 * Linear wizard with conditional skips via useMemo<StepKey[]>. Each step is
 * a small component that calls `onNext(answers)` when the user advances; the
 * wizard owns the answer accumulator and the step index. Add a new step by
 * (1) adding a key to StepKey, (2) appending the component to the switch
 * below, and (3) including/excluding it in the sequence useMemo based on
 * environment (self-hosted vs hosted, etc.).
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
  { key: "auth", label: "Auth" },
  { key: "org", label: "Org" },
  { key: "provider", label: "Provider" },
  { key: "model", label: "Model" },
  { key: "byok", label: "BYOK" },
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

  // Conditional sequence. Steps that don't apply for the current answers
  // are filtered out:
  //   - For Ollama, the "ollama-setup" step does everything (URL prompt,
  //     daemon probe, model picker/puller) so the separate "model", "byok",
  //     and "validate" steps are all redundant. Validate would just re-probe
  //     the same URL ollama-setup already probed; byok asks for a key
  //     Ollama doesn't have. Skipping them gets the user to Done faster
  //     and removes empty tabs from the header.
  //   - "ollama-setup" is also skipped for non-Ollama providers.
  //
  // The Ollama-vs-rest reshape only takes effect once ProviderStep has
  // been passed through this session (`providerConfirmed`). Before that
  // we show the full sequence so a --reset user who wants to switch
  // away from Ollama isn't confused by the Ollama tab in the header.
  const sequence = useMemo<StepKey[]>(() => {
    const isOllama = providerConfirmed && answers.provider === "ollama";
    return STEPS.map((s) => s.key).filter((k) => {
      if (isOllama) {
        if (k === "model" || k === "byok" || k === "validate") return false;
      } else {
        if (k === "ollama-setup") return false;
      }
      return true;
    });
  }, [answers.provider, providerConfirmed]);

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

  const next = (patch: Partial<OctopusConfig> = {}) => {
    setAnswers((a) => ({ ...a, ...patch }));
    setStepIndex((i) => Math.min(i + 1, sequence.length - 1));
  };

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
      {activeKey === "auth" && <AuthStep onNext={(p) => next(p)} />}
      {activeKey === "org" && <OrgStep onNext={() => next()} onSwitchOrg={() => jumpTo("auth")} />}
      {activeKey === "provider" && (
        <ProviderStep
          onNext={(p) => {
            setProviderConfirmed(true);
            next(p);
          }}
        />
      )}
      {activeKey === "model" && (
        <ModelStep provider={answers.provider ?? ""} onNext={(p) => next(p)} />
      )}
      {activeKey === "byok" && (
        <ByokStep
          provider={answers.provider ?? ""}
          onNext={() => next()}
        />
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
          onNext={() => next()}
          onEditKey={() => jumpTo("byok")}
        />
      )}
      {activeKey === "repo" && <RepoStep onNext={() => next()} />}
      {activeKey === "done" && <DoneStep answers={answers} />}
    </Box>
  );
}
