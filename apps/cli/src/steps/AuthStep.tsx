import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { getJson, normalizeBaseUrl, postJson } from "../lib/api.js";
import { openBrowser } from "../lib/auth.js";
import { saveCredentials, type Credentials } from "../lib/credentials.js";
import { HOSTED_BASE_URL, buildHostingPatch } from "../lib/hosting.js";

const POLL_INTERVAL_MS = 2000;

type Mode = "choose-mode" | "self-hosted-url" | "requesting" | "waiting" | "approved" | "failed" | "skipped";

type DeviceResponse = { deviceCode: string; expiresAt: string };
type PollResponse =
  | { status: "pending" }
  | {
      status: "approved";
      token: string;
      organization: { id: string; slug: string; name: string };
      user: { name?: string; email?: string };
    };

export type AuthStepProps = {
  /**
   * Called with `selfHostedBaseUrl` set when the user chose self-hosted and
   * explicitly cleared (undefined) for Cloud, so a --reset-seeded value does
   * not survive a switch back to Cloud.
   */
  onNext: (patch: { selfHostedBaseUrl?: string }) => void;
};

const buildPatch = buildHostingPatch;

/**
 * Step 2 of the onboarding wizard.
 *
 *   choose-mode      → "Cloud (Octopus hosted)" vs "Self-hosted (enter URL)"
 *     ↓
 *   self-hosted-url  → text input for base URL (skipped on Cloud)
 *     ↓
 *   requesting       → POST /api/cli/auth/device, get { deviceCode, expiresAt }
 *     ↓
 *   waiting          → open the approval URL in the browser (Enter re-opens),
 *                      print it as fallback, poll /api/cli/auth/poll every 2s
 *     ↓
 *   approved         → write credentials, call onNext({ baseUrl })
 *
 * Failures from any of the network steps land in `failed`. Esc skips at any
 * point — the user can complete onboarding without auth and configure later.
 */
export function AuthStep({ onNext }: AuthStepProps) {
  const [mode, setMode] = useState<Mode>("choose-mode");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [selfHostedInput, setSelfHostedInput] = useState<string>("");
  const [deviceCode, setDeviceCode] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [openState, setOpenState] = useState<"idle" | "opened" | "failed">("idle");

  // Global Esc → skip the whole step (user can configure auth later).
  // Now also allowed during `requesting` so the wizard isn't hard-locked
  // on a stalled host: the device-code request has a per-call timeout
  // below, but a user staring at "Requesting device code from …" still
  // wants an Esc that works rather than Ctrl+C'ing out of the whole
  // onboarding wizard. `approved` and `waiting` are kept off-limits
  // because in those states bailing would corrupt session state.
  // From the failed phase: Enter retries with the current URL, `b` (or
  // backspace) jumps back to URL entry so the user can fix a typo /
  // re-point at the right host without bouncing through the whole step.
  useInput((input, key) => {
    if (key.escape && mode !== "approved" && mode !== "waiting") {
      setMode("skipped");
      onNext(buildPatch(baseUrl || HOSTED_BASE_URL));
    }
    if (mode === "waiting") {
      // Enter re-opens the approval page; Esc abandons this device code and
      // returns to the Cloud / self-hosted choice (the poll effect is torn
      // down by the mode change).
      if (key.return && baseUrl && deviceCode) {
        void openBrowser(`${baseUrl}/cli/authorize?code=${deviceCode}`).then((ok) =>
          setOpenState(ok ? "opened" : "failed"),
        );
      } else if (key.escape) {
        setDeviceCode("");
        setExpiresAt(null);
        setOpenState("idle");
        setMode("choose-mode");
      }
    }
    if (mode === "failed") {
      if (key.return) {
        setError("");
        setMode("requesting");
      } else if (input === "b" || input === "B" || key.backspace || key.delete) {
        setError("");
        setMode("self-hosted-url");
      }
    }
  });

  // Kick off device-code request when entering `requesting`. Bounded by
  // a 15s timeout so a firewalled / blackholed self-hosted URL doesn't
  // hang the wizard indefinitely — the user gets a "Could not request
  // device code" error and lands in `failed` where Enter retries and
  // `b` returns to URL entry.
  useEffect(() => {
    if (mode !== "requesting") return;
    let cancelled = false;
    (async () => {
      const url = `${baseUrl}/api/cli/auth/device`;
      const res = await postJson<DeviceResponse>(url, {}, undefined, { timeoutMs: 15_000 });
      if (cancelled) return;
      if (!res.ok) {
        setError(`Could not request device code: ${res.error}`);
        setMode("failed");
        return;
      }
      setDeviceCode(res.data.deviceCode);
      setExpiresAt(new Date(res.data.expiresAt));
      setMode("waiting");
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, baseUrl]);

  // Poll while waiting.
  useEffect(() => {
    if (mode !== "waiting" || !deviceCode) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      if (expiresAt && new Date() > expiresAt) {
        setError("Device code expired before approval. Press Enter to retry.");
        setMode("failed");
        return;
      }
      const url = `${baseUrl}/api/cli/auth/poll?device_code=${encodeURIComponent(deviceCode)}`;
      const res = await getJson<PollResponse>(url);
      if (cancelled) return;
      if (!res.ok) {
        setError(`Poll failed: ${res.error}`);
        setMode("failed");
        return;
      }
      if (res.data.status === "pending") return;
      // Approved — persist + advance.
      const creds: Credentials = {
        baseUrl,
        token: res.data.token,
        orgId: res.data.organization.id,
        orgSlug: res.data.organization.slug,
        orgName: res.data.organization.name,
        userName: res.data.user.name,
        userEmail: res.data.user.email,
        approvedAt: new Date().toISOString(),
      };
      try {
        await saveCredentials(creds);
      } catch (e) {
        setError(`Could not save credentials: ${e instanceof Error ? e.message : String(e)}`);
        setMode("failed");
        return;
      }
      setMode("approved");
      // Brief pause to let the user see the success line before advancing.
      setTimeout(() => onNext(buildPatch(baseUrl)), 600);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, deviceCode, expiresAt, baseUrl, onNext]);

  const verificationUrl = useMemo(() => {
    if (!baseUrl || !deviceCode) return "";
    return `${baseUrl}/cli/authorize?code=${deviceCode}`;
  }, [baseUrl, deviceCode]);

  // Open the approval page once per device code. Shell-free spawn (see
  // lib/auth.ts); the URL stays on screen as the fallback for headless / SSH
  // sessions where nothing can open.
  useEffect(() => {
    if (mode !== "waiting" || !verificationUrl) return;
    let cancelled = false;
    setOpenState("idle");
    openBrowser(verificationUrl).then((ok) => {
      if (!cancelled) setOpenState(ok ? "opened" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [mode, verificationUrl]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (mode === "choose-mode") {
    return (
      <Box flexDirection="column">
        <Text bold>Sign in to Octopus</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Cloud (Octopus hosted) - octopus-review.ai", value: "hosted" },
            { label: "Self-hosted - I run my own instance", value: "self-hosted" },
            { label: "Skip - I'll sign in later", value: "skip" },
          ]}
          onSelect={(item) => {
            if (item.value === "hosted") {
              setBaseUrl(HOSTED_BASE_URL);
              setMode("requesting");
            } else if (item.value === "self-hosted") {
              setMode("self-hosted-url");
            } else {
              setMode("skipped");
              onNext({});
            }
          }}
        />
        <Text> </Text>
        <Text dimColor>Use ↑/↓ to move, Enter to select · Esc to skip</Text>
      </Box>
    );
  }

  if (mode === "self-hosted-url") {
    return (
      <Box flexDirection="column">
        <Text bold>Self-hosted Octopus base URL</Text>
        <Text dimColor>Example: https://octopus.internal.acme.com</Text>
        <Text> </Text>
        <Text>URL: </Text>
        <TextInput
          value={selfHostedInput}
          onChange={setSelfHostedInput}
          onSubmit={(value) => {
            const normalized = normalizeBaseUrl(value);
            if (!normalized) {
              setError("Not a valid http(s) URL. Please re-enter.");
              return;
            }
            setError("");
            setBaseUrl(normalized);
            setMode("requesting");
          }}
        />
        {error ? <Text color="red">{error}</Text> : null}
        <Text> </Text>
        <Text dimColor>Enter to submit · Esc to skip</Text>
      </Box>
    );
  }

  if (mode === "requesting") {
    return (
      <Box flexDirection="column">
        <Text>Requesting device code from {baseUrl} …</Text>
      </Box>
    );
  }

  if (mode === "waiting") {
    return (
      <Box flexDirection="column">
        <Text bold>Approve this sign-in in your browser</Text>
        <Text> </Text>
        <Text color="cyan">{verificationUrl}</Text>
        {openState === "opened" ? (
          <Text dimColor>Opened in your browser. Approve there, or use the URL above.</Text>
        ) : null}
        {openState === "failed" ? (
          <Text color="yellow">Could not open a browser (headless/SSH?). Open the URL above manually.</Text>
        ) : null}
        <Text> </Text>
        <Text dimColor>Waiting for approval … (polls every {POLL_INTERVAL_MS / 1000}s)</Text>
        {expiresAt ? (
          <Text dimColor>Code expires at {expiresAt.toLocaleTimeString()}.</Text>
        ) : null}
        <Text> </Text>
        <Text dimColor>Enter: open browser again · Esc: back · Ctrl+C: quit</Text>
      </Box>
    );
  }

  if (mode === "approved") {
    return (
      <Box flexDirection="column">
        <Text color="green" bold>Signed in.</Text>
        <Text>Credentials saved to ~/.octopus/credentials.</Text>
      </Box>
    );
  }

  if (mode === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Sign-in failed.</Text>
        <Text color="red">{error}</Text>
        {baseUrl ? (
          <Text dimColor>Base URL: {baseUrl}</Text>
        ) : null}
        <Text> </Text>
        <Text dimColor>Enter: retry · B: edit URL · Esc: skip</Text>
      </Box>
    );
  }

  // skipped — already advanced; render nothing.
  return null;
}
