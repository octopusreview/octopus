/**
 * GET /api/version
 *
 * Reports the running build's identifiers. Used by:
 *   - The /settings/updates page (compares `version` against the latest
 *     GitHub release).
 *   - The CLI's `octp doctor` subcommand.
 *   - Bug reports.
 */
export function GET() {
  return Response.json({
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
    buildId: process.env.NEXT_PUBLIC_BUILD_ID,
    server: process.env.OCTOPUS_SERVER_ID || "unknown",
    selfHosted: process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED === "true",
  });
}
