/**
 * Where Octopus runs for this user: Cloud (Octopus hosted, octopus-review.ai)
 * or a self-hosted instance. Cloud is the default and is not stored in prefs.
 */
export const HOSTED_BASE_URL = "https://octopus-review.ai";

export function isCloudBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return true;
  return baseUrl.replace(/\/+$/, "") === HOSTED_BASE_URL;
}

/**
 * Prefs patch for the chosen base URL. Cloud explicitly clears
 * `selfHostedBaseUrl` so a value seeded by `octp onboard --reset` from an
 * earlier self-hosted run cannot survive a switch back to Cloud.
 */
export function buildHostingPatch(baseUrl: string): { selfHostedBaseUrl?: string } {
  return baseUrl && !isCloudBaseUrl(baseUrl) ? { selfHostedBaseUrl: baseUrl } : { selfHostedBaseUrl: undefined };
}
