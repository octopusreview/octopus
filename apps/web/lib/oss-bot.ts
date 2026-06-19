/**
 * Shared helpers for OSS bot-account review mode.
 *
 * In this mode Octopus reviews public PRs and posts as a dedicated GitHub bot user account,
 * triggered by a zero-permission workflow in the target repo (it only notifies our server;
 * it grants no write access and runs no privileged code). Consent is gated on a maintainer-
 * controlled file in the repo so a spoofed trigger can never make the bot comment on a repo
 * whose maintainers didn't opt in.
 */

import { getFileContent } from "@/lib/github";

/** Maintainer-controlled opt-in marker. Its presence on the default branch is consent. */
export const CONSENT_FILE_PATH = ".github/octopus.yml";

/** The shared bot account's GitHub token (a classic PAT with public_repo scope). */
export function getBotToken(): string {
  const token = process.env.OCTOPUS_BOT_GITHUB_TOKEN;
  if (!token) {
    throw new Error("OCTOPUS_BOT_GITHUB_TOKEN is not configured");
  }
  return token;
}

export function isBotAccountConfigured(): boolean {
  return Boolean(process.env.OCTOPUS_BOT_GITHUB_TOKEN);
}

/**
 * Returns true when the repo has opted into bot-account reviews by committing
 * the consent file to its default branch. installationId is 0 (unused) since
 * we authenticate with the bot token.
 */
export async function hasConsentFile(
  owner: string,
  repo: string,
  defaultBranch: string,
  botToken: string,
): Promise<boolean> {
  const content = await getFileContent(0, owner, repo, defaultBranch, CONSENT_FILE_PATH, botToken);
  return content !== null;
}
