import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { loadCredentials } from "../lib/credentials.js";
import { getJson } from "../lib/api.js";
import { openBrowser } from "../lib/auth.js";

const GITHUB_APP_SLUG = process.env.OCTOPUS_GITHUB_APP_SLUG ?? "octopus-review";

export type RepoStepProps = {
  onNext: () => void;
};

type Repo = {
  id: string;
  name: string;
  fullName: string;
  provider: string;
  indexStatus: string;
  indexedAt: string | null;
  autoReview: boolean;
};

type Phase = "loading" | "no-creds" | "loaded" | "failed";

/**
 * Connect a repo to Octopus.
 *
 * Today's scope: list the org's already-connected repos (via /api/cli/repos)
 * with their index/review status. If the user wants to add a new repo we
 * link them to the GitHub App install page; we don't fetch their GitHub
 * repo list (that needs a different OAuth scope and is a separate epic).
 *
 * Self-hosted: skipped — repos there are added via the web UI's GitHub
 * integration page, not via this wizard.
 */
export function RepoStep({ onNext }: RepoStepProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [error, setError] = useState<string>("");
  const [installUrl, setInstallUrl] = useState<string>("");
  const [openState, setOpenState] = useState<"idle" | "opened" | "failed">("idle");

  useInput((_input, key) => {
    if (key.escape && phase !== "loading") onNext();
  });

  // Open the GitHub App install page in the system browser (reusing the same
  // shell-free helper the PKCE auth step uses). The URL stays on screen as a
  // fallback, so a spawn failure is non-fatal — we just tell the user to open
  // it themselves rather than claiming success.
  const handleSelect = async (value: string) => {
    if (value === "install") {
      const opened = await openBrowser(installUrl);
      setOpenState(opened ? "opened" : "failed");
      return;
    }
    onNext();
  };

  useEffect(() => {
    (async () => {
      const creds = await loadCredentials();
      if (!creds) {
        setPhase("no-creds");
        onNext();
        return;
      }

      // Self-hosted users: skip the repo step entirely. The hosted GitHub
      // App install flow is irrelevant for them.
      const isHosted = creds.baseUrl === "https://octopus-review.ai";
      if (!isHosted) {
        onNext();
        return;
      }

      setInstallUrl(`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`);

      const res = await getJson<{ repos: Repo[] }>(`${creds.baseUrl}/api/cli/repos`, {
        headers: { authorization: `Bearer ${creds.token}` },
      });
      if (!res.ok) {
        setError(`Could not list repos: ${res.error}`);
        setPhase("failed");
        return;
      }
      setRepos(res.data.repos);
      setPhase("loaded");
    })();
  }, [onNext]);

  if (phase === "loading") {
    return (
      <Box flexDirection="column">
        <Text>Loading connected repositories …</Text>
      </Box>
    );
  }

  if (phase === "no-creds") return null;

  if (phase === "failed") {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Could not list repos.</Text>
        <Text color="red">{error}</Text>
        <Text> </Text>
        <Text dimColor>Esc to continue anyway.</Text>
      </Box>
    );
  }

  // loaded
  if (repos.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>No repositories connected yet</Text>
        <Text> </Text>
        <Text>Install the Octopus GitHub App to start reviewing PRs:</Text>
        <Text color="cyan">{installUrl}</Text>
        <Text> </Text>
        <Text dimColor>Open the URL in your browser, pick a repo, click Install.</Text>
        <Text dimColor>You can always do this later from the Octopus web UI.</Text>
        {openState === "opened" ? (
          <Text color="green">Opened the install page in your browser.</Text>
        ) : null}
        {openState === "failed" ? (
          <Text color="yellow">Could not open a browser — use the URL above.</Text>
        ) : null}
        <Text> </Text>
        <SelectInput
          items={[
            { label: "Install the Octopus GitHub App (opens browser)", value: "install" },
            { label: "Continue (I'll install later)", value: "continue" },
          ]}
          onSelect={(item) => void handleSelect(item.value)}
        />
      </Box>
    );
  }

  // Show connected repos as an informational list, then offer continue.
  return (
    <Box flexDirection="column">
      <Text bold>Connected repositories ({repos.length})</Text>
      <Text> </Text>
      {repos.slice(0, 8).map((r) => (
        <Text key={r.id}>
          {" "}{statusBadge(r.indexStatus)} {r.fullName}{" "}
          <Text dimColor>· {r.autoReview ? "auto-review on" : "auto-review off"}</Text>
        </Text>
      ))}
      {repos.length > 8 ? <Text dimColor>  …and {repos.length - 8} more</Text> : null}
      <Text> </Text>
      <Text dimColor>
        Add more repos at <Text color="cyan">{installUrl}</Text>
      </Text>
      {openState === "opened" ? (
        <Text color="green">Opened the install page in your browser.</Text>
      ) : null}
      {openState === "failed" ? (
        <Text color="yellow">Could not open a browser — use the URL above.</Text>
      ) : null}
      <Text> </Text>
      <SelectInput
        items={[
          { label: "Install on another repo (opens browser)", value: "install" },
          { label: "Continue", value: "continue" },
        ]}
        onSelect={(item) => handleSelect(item.value)}
      />
    </Box>
  );
}

function statusBadge(status: string): string {
  if (status === "indexed") return "✓";
  if (status === "indexing") return "↻";
  if (status === "failed") return "✗";
  return "·"; // pending or unknown
}
