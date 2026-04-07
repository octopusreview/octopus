import { NextResponse } from "next/server";

function getBaseUrl() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function GET() {
  const baseUrl = getBaseUrl();

  const manifest = {
    schema: "https://collab.dev/manifest/v1",
    name: "Octopus",
    slug: "octopus",
    version: "1.0.0",
    description:
      "AI-powered code review and repository analysis tool. Octopus automatically reviews pull requests, generates architectural diagrams, and provides intelligent codebase insights.",

    type: "embed",
    entrypoint_url: baseUrl,
    icon_url: `${baseUrl}/icon.png`,

    publisher: {
      name: "Octopus",
      url: baseUrl,
      support_email: "support@octopus-review.ai",
      privacy_url: `${baseUrl}/privacy`,
      terms_url: `${baseUrl}/terms`,
    },

    oauth: {
      client_type: "confidential",
      token_endpoint_auth_method: "client_secret_basic",
      redirect_uris: [`${baseUrl}/api/oauth/collab/callback`],
      scopes: [
        "workspace:read",
        "projects:read",
        "projects:write",
        "issues:read",
        "issues:write",
        "comments:read",
        "comments:write",
      ],
    },

    webhooks: {
      endpoints: [
        {
          url: `${baseUrl}/api/collab/webhook`,
          events: [
            "issue.created",
            "issue.updated",
            "issue.status_changed",
            "comment.created",
          ],
          signature: {
            type: "HMAC_SHA256",
            header: "X-Collab-Signature",
          },
          tolerance_seconds: 300,
          retries: {
            max: 5,
            backoff: "exponential",
          },
        },
      ],
    },

    scopes: [
      "workspace:read",
      "projects:read",
      "projects:write",
      "issues:read",
      "issues:write",
      "comments:read",
      "comments:write",
    ],

    permissions: {
      org: true,
      user: false,
    },

    category: "Developer Tools",
    visibility: "public",

    versions: {
      min_api: "2025-01",
      tested_api: "2025-01",
    },
  };

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
