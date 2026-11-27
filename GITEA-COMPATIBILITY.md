# Self-hosted Gitea compatibility (opt-in)

Octopus can use the existing **direct** Forgejo adapter with a compatible
self-hosted Gitea instance. The adapter uses the shared API v1 repository and PR
contracts. No database migration is required; these connections display as
**Forgejo** in the Octopus UI. The Forgejo Cloud connector is not supported.

1. Set **GITEA_COMPATIBLE_ORIGINS** on the Octopus web service to the exact
   normalized HTTPS origin of each Gitea server, separated by commas. Include a
   non-default port if applicable. Do not include paths or trailing slashes.
2. If a Gitea origin resolves to a private address, also configure that exact
   origin in **FORGEJO_ALLOWED_PRIVATE_ORIGINS** on Octopus web and workers.
   Keep TLS verification enabled and provide the trusted CA if needed.
3. In **Settings → Integrations → Forgejo**, connect Gitea directly with a
   dedicated user that administers only the intended repositories. Start with one
   synthetic repository. Sync it and copy the generated webhook URL and secret.
4. In that repository's **Settings → Webhooks**, add a **Gitea** webhook,
   using POST and JSON. Use the Octopus URL and secret. Enable pull request
   events, synchronization, and PR comments if you want mention-triggered
   reviews. Octopus must be reachable by the delivery process; do not expose
   its dashboard or weaken its signature check to make webhooks work.
5. Verify that a synthetic PR opens a review, that a new head is reviewed,
   that a review comment and commit status appear, and that a redelivery
   is not queued twice. Verify a configured model without a paid fallback
   separately; successful webhook delivery alone does not prove a review ran.

Matching is scoped to the stored integration origin. Only opted-in direct
self-hosted integrations use **X-Gitea-Signature** and **X-Gitea-Event**.
Other integrations continue to use the Forgejo headers. Both modes require
the existing per-integration HMAC-SHA256 verification of the raw request body;
tenant scoping and deduplication are unchanged. No additional network routes
are granted by this setting.

To turn it off, disable the Gitea webhook, remove the origin from
**GITEA_COMPATIBLE_ORIGINS**, and redeploy the web service. If retiring the
integration, disconnect it and revoke its dedicated access token.
