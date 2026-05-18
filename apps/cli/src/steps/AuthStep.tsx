import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { getJson, normalizeBaseUrl, postJson } from "../lib/api.js";
import { saveCredentials, type Credentials } from "../lib/credentials.js";

const HOSTED_BASE_URL = "https://octopus-review.ai";
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
   * Called with `selfHostedBaseUrl` set only when the user chose self-hosted.
   * Hosted is the default so we do not store it in prefs.
   */
  onNext: (patch: { selfHostedBaseUrl?: string }) => void;
};

function buildPatch(baseUrl: string): { selfHostedBaseUrl?: string } {
  return baseUrl && baseUrl !== HOSTED_BASE_URL ? { selfHostedBaseUrl: baseUrl } : {};
}

/**
 * Step 2 of the onboarding wizard.
 *
 *   choose-mode      → "Hosted (octopus-review.ai)" vs "Self-hosted (enter URL)"
 *     ↓
 *   self-hosted-url  → text input for base URL (skipped in hosted mode)
 *     ↓
 *   requesting       → POST /api/cli/auth/device, get { deviceCode, expiresAt }
 *     ↓
 *   waiting          → render the URL + deviceCode, poll /api/cli/auth/poll every 2s
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

  // Global Esc → skip the whole step (user can configure auth later).
  useInput((_input, key) => {
    if (key.escape && mode !== "approved" && mode !== "requesting" && mode !== "waiting") {
      setMode("skipped");
      onNext(buildPatch(baseUrl || HOSTED_BASE_URL));
    }
    if (key.return && mode === "failed") {
      // Retry from the beginning of the network sequence.
      setError("");
      setMode("requesting");
    }
  });

  // Kick off device-code request when entering `requesting`.
  useEffect(() => {
    if (mode !== "requesting") return;
    let cancelled = false;
    (async () => {
      const url = `${baseUrl}/api/cli/auth/device`;
      const res = await postJson<DeviceResponse>(url, {});
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (mode === "choose-mode") {
    return (
      <Box flexDirection="column">
        <Text bold>Sign in to Octopus</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Hosted — octopus-review.ai", value: "hosted" },
            { label: "Self-hosted — I run my own instance", value: "self-hosted" },
            { label: "Skip — I'll configure auth later", value: "skip" },
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
        <Text bold>Open this URL in your browser to approve:</Text>
        <Text> </Text>
        <Text color="cyan">{verificationUrl}</Text>
        <Text> </Text>
        <Text dimColor>Waiting for approval … (polls every {POLL_INTERVAL_MS / 1000}s)</Text>
        {expiresAt ? (
          <Text dimColor>Code expires at {expiresAt.toLocaleTimeString()}.</Text>
        ) : null}
        <Text> </Text>
        <Text dimColor>Ctrl+C to abort</Text>
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
        <Text> </Text>
        <Text dimColor>Enter to retry · Esc to skip</Text>
      </Box>
    );
  }

  // skipped — already advanced; render nothing.
  return null;
}
