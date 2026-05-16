# Octopus on Databricks — deployment runbook

This directory contains the Databricks Asset Bundle (DAB) + bootstrap scripts
+ Databricks App config that deploys Octopus to the FEVM workspace
`octopus-ai` (AWS us-east-1).

The full migration plan lives at
`~/.claude/plans/ultrathink-i-have-created-sparkling-volcano.md`.

```
databricks/
├── README.md                 # ← you are here
├── bootstrap/
│   ├── create_lakebase.py    # idempotent Lakebase Autoscale project + endpoint
│   ├── create_indexes.py     # idempotent 7 Direct Access VS indexes
│   └── requirements.txt      # databricks-sdk
└── app/
    ├── app.yaml              # uploaded as app source — runtime command + env
    ├── .databricksignore     # what to exclude when staging app source
    └── _stage/               # populated by `bun run app:assemble` (gitignored)
```

DAB resources live one directory up at `../resources/*.yml`, declared by
`../databricks.yml`.

## Quick deploy

```bash
# 0. one-time
databricks auth login --host https://octopus-ai.cloud.databricks.com --profile octopus-ai

# 1. provision infra (VS endpoint, AI Gateway endpoints, secret scope, app shell)
databricks bundle validate -t octopus-ai --profile octopus-ai
databricks bundle deploy   -t octopus-ai --profile octopus-ai

# 2. push secrets (interactive)
databricks secrets put-secret octopus-octopus-ai anthropic_api_key    --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai openai_api_key       --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai google_api_key       --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai cohere_api_key       --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai better_auth_secret   --profile octopus-ai
# (GitHub App secrets come later — see step 6.)

# 3. provision Lakebase + VS indexes
databricks bundle run bootstrap_job -t octopus-ai --profile octopus-ai

# 4. one-time UC grants (run from the Databricks SQL editor or via CLI)
#   GRANT USE CATALOG ON CATALOG octopus_ai_catalog TO `<app-sp-client-id>`;
#   GRANT USE SCHEMA, SELECT, MODIFY ON SCHEMA octopus_ai_catalog.vectors TO `<app-sp-client-id>`;
#   GRANT USE SCHEMA, SELECT ON SCHEMA octopus_ai_catalog.gateway TO `<app-sp-client-id>`;
# Find the SP client id with: `databricks apps get octopus --profile octopus-ai | jq .service_principal_client_id`

# 5. run Prisma migrations against Lakebase (laptop, 1-hour OAuth token)
bun run db:deploy:databricks

# 6. build, stage, and deploy the app
bun install --frozen-lockfile
bun run db:generate
bunx turbo build --filter=@octopus/web
bun run app:assemble
databricks bundle deploy -t octopus-ai --profile octopus-ai
databricks bundle run    octopus -t octopus-ai --profile octopus-ai

# 7. find the assigned app URL
APP_URL=$(databricks apps get octopus --profile octopus-ai --output json | jq -r .url)
echo "$APP_URL"

# 8. register a new GitHub App in the GitHub UI pointed at $APP_URL
#    Webhook URL: $APP_URL/api/github/webhook
#    Callback URL: $APP_URL/api/github/callback
#    Permissions: contents:read, pull_requests:write, checks:write, metadata:read
#    Generate a private key (PEM) and webhook secret.

# 9. push GitHub App secrets + redeploy
databricks secrets put-secret octopus-octopus-ai github_app_id          --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai github_app_private_key --profile octopus-ai --string-value "$(cat github-app.pem)"
databricks secrets put-secret octopus-octopus-ai github_webhook_secret  --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai github_client_id       --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai github_client_secret   --profile octopus-ai
databricks secrets put-secret octopus-octopus-ai github_state_secret    --profile octopus-ai
databricks bundle run octopus -t octopus-ai --profile octopus-ai

# 10. open $APP_URL in a browser — you'll be redirected through dbx-bootstrap
#     and land on /dashboard authenticated as the Databricks user.

# 11. install the GitHub App on a test repo, open a PR with a planted bug,
#     watch logs:
databricks apps logs octopus --profile octopus-ai --follow
```

## Smoke tests

After deploy, run from a laptop with the Databricks env vars exported (or via
`databricks` CLI auth):

```bash
bun run scripts/smoke/lakebase.ts --quick       # connection + Prisma works
bun run scripts/smoke/vs.ts                     # upsert + query + delete
bun run scripts/smoke/ai-gateway.ts             # Claude + OpenAI + Gemini + embeddings
```

For the 70-minute token-refresh test, drop `--quick` from the lakebase script.

## Rollback

- `git checkout pre-databricks` restores the EC2 / Docker Compose path
- `databricks bundle destroy -t octopus-ai --profile octopus-ai` tears down VS endpoint, model serving, app shell, secrets
- Lakebase project teardown (separate, since it's bootstrap-script-managed):
  `databricks database delete-database-project octopus-app --profile octopus-ai`

## What's stubbed in this deploy

All disabled by default; flip the matching `FEATURES_X=true` flag in
`databricks/app/app.yaml` to re-enable any of them:

- Stripe billing (`FEATURES_BILLING`)
- Pubby real-time WebSockets (`FEATURES_PUBBY`) — chat polls every 3 s instead
- R2 avatar uploads (`FEATURES_R2`) — jdenticons returned instead
- SMTP / Resend email (`FEATURES_EMAIL`)
- Linear / Jira / Slack / Bitbucket / GitLab integrations (`FEATURES_*`)

Permanently removed in this deploy:
- Elasticsearch sync logs (now `console.log`)
- Ollama provider
- Magic-link auth + Google/GitHub user-login social providers (kept for AUTH_MODE=local)

GitHub App integration for webhooks + repo cloning is **kept** — that's the
core review path and is unrelated to user auth.
