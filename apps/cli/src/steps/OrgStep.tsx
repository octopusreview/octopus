import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { loadCredentials, type Credentials } from "../lib/credentials.js";
import { getJson } from "../lib/api.js";

type MeResponse = {
  user: { id: string; name: string; email: string };
  organization: {
    id: string;
    name: string;
    slug: string;
    memberCount: number;
    repoCount: number;
  };
};

export type OrgStepProps = {
  onNext: () => void;
  /**
   * Called when the user wants to switch organizations. The wizard sends them
   * back to the Auth step where a fresh device-code flow targets a different org.
   */
  onSwitchOrg: () => void;
};

type Mode = "loading" | "no-creds" | "verifying" | "ready" | "failed";

/**
 * Confirmation step. Per the current API, a CLI token is scoped to one
 * organization — there is no multi-org switcher. So OrgStep loads the saved
 * credentials, hits /api/cli/me to verify the token is still valid + show
 * fresh member/repo counts, then asks "continue with this org or re-sign in
 * to switch?"
 *
 * If the user skipped auth (no credentials file), this step skips itself.
 */
export function OrgStep({ onNext, onSwitchOrg }: OrgStepProps) {
  const [mode, setMode] = useState<Mode>("loading");
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      const loaded = await loadCredentials();
      if (!loaded) {
        // Auth was skipped — nothing to confirm. Pass through.
        setMode("no-creds");
        onNext();
        return;
      }
      setCreds(loaded);
      setMode("verifying");

      const res = await getJson<MeResponse>(`${loaded.baseUrl}/api/cli/me`, {
        headers: { authorization: `Bearer ${loaded.token}` },
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? "Saved credentials were rejected. Re-sign in to continue."
            : `Could not verify session: ${res.error}`,
        );
        setMode("failed");
        return;
      }
      setMe(res.data);
      setMode("ready");
    })();
  }, [onNext]);

  if (mode === "loading" || mode === "verifying") {
    return (
      <Box flexDirection="column">
        <Text>Verifying session …</Text>
      </Box>
    );
  }

  if (mode === "no-creds") {
    return null; // already advanced
  }

  if (mode === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Session check failed.</Text>
        <Text color="red">{error}</Text>
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Re-sign in", value: "switch" },
            { label: "Continue anyway (skip session check)", value: "skip" },
          ]}
          onSelect={(item) => (item.value === "switch" ? onSwitchOrg() : onNext())}
        />
      </Box>
    );
  }

  // ready — normalise the two sources (live `/api/cli/me` response and the
  // saved credentials) into the same shape so we don't have to discriminate
  // the union at every property access.
  const org = me?.organization
    ? { name: me.organization.name, slug: me.organization.slug }
    : { name: creds!.orgName, slug: creds!.orgSlug };
  const user = me?.user;
  return (
    <Box flexDirection="column">
      <Text bold>Signed in to organization</Text>
      <Text> </Text>
      <Text>  Org:   <Text color="cyan">{org.name}</Text> ({org.slug})</Text>
      {user ? <Text>  User:  {user.name} &lt;{user.email}&gt;</Text> : null}
      {me ? (
        <>
          <Text>  Members: {me.organization.memberCount}</Text>
          <Text>  Repos:   {me.organization.repoCount}</Text>
        </>
      ) : null}
      <Text> </Text>
      <SelectInput
        items={[
          { label: `Continue with ${org.name}`, value: "continue" },
          { label: "Switch organization (re-sign in)", value: "switch" },
        ]}
        onSelect={(item) => (item.value === "switch" ? onSwitchOrg() : onNext())}
      />
    </Box>
  );
}
