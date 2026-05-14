# GitHub App setup for Octopus on Databricks Apps

Once Octopus is running on Databricks Apps, the **Connect GitHub** button in
the dashboard installs a GitHub App into a target repo so Octopus can:

- receive `pull_request`/`push` webhooks
- post inline review comments + check-run results
- clone repos for indexing

The GitHub App itself has to be created **once** (per environment) in your
GitHub account or org. This doc walks through it end-to-end.

Public app URL referenced throughout:

```
https://octopus-7474653762789335.aws.databricksapps.com
```

> If your app URL changes (re-deployment, new workspace), update every
> field below that references it.

---

## 1. Create the GitHub App

Open one of these in your browser (depending on whether you want the app
under your user or under a GitHub org):

| Where you want the App | URL |
|---|---|
| Personal account | <https://github.com/settings/apps/new> |
| Inside a GitHub org | `https://github.com/organizations/<ORG>/settings/apps/new` |

Fill in the form like this:

| Field | Value |
|---|---|
| **GitHub App name** | `octopus-ai-demo` |
| **Description** | _AI-powered code review for the octopus-ai Databricks workspace._ |
| **Homepage URL** | `https://octopus-7474653762789335.aws.databricksapps.com` |
| **Callback URL** (User authorization) | `https://octopus-7474653762789335.aws.databricksapps.com/api/github/callback` |
| **Expire user authorization tokens** | ✅ checked |
| **Request user authorization (OAuth) during installation** | ✅ checked |
| **Setup URL** (optional — but recommended) | `https://octopus-7474653762789335.aws.databricksapps.com/api/github/callback` |
| **Redirect on update** | ✅ checked |
| **Webhook → Active** | ✅ checked |
| **Webhook URL** | `https://octopus-7474653762789335.aws.databricksapps.com/api/github/webhook` |
| **Webhook secret** | Generate a 64-char hex string: `openssl rand -hex 32` (save it; you'll push it to Databricks below) |
| **SSL verification** | Enable |

> The **App name MUST be exactly `octopus-ai-demo`** — that's the slug encoded
> in `NEXT_PUBLIC_GITHUB_APP_SLUG` inside `databricks/app/app.yaml`. If you
> want a different name, change the env var to match before redeploying.

---

## 2. Permissions

Set repository permissions to:

| Permission | Access |
|---|---|
| **Contents** | Read-only |
| **Pull requests** | Read & write |
| **Issues** | Read & write |
| **Checks** | Read & write |
| **Metadata** | Read-only (auto) |
| **Commit statuses** | Read & write |

Account-level permissions: none required.

---

## 3. Subscribe to events

Check these webhook event boxes:

- ✅ Pull request
- ✅ Pull request review
- ✅ Pull request review comment
- ✅ Push
- ✅ Check run
- ✅ Check suite
- ✅ Installation
- ✅ Installation repositories

---

## 4. Installation scope

Under **Where can this GitHub App be installed?**, pick:

- **Any account** — required if you want to install this App on your personal repos AND your org's repos. Use this for a demo.
- **Only on this account** — locks installation to the user/org that created the App. Safer for production.

Then click **Create GitHub App**.

---

## 5. Capture App credentials

A GitHub App has **two separate identities**, each with its own credential
pair — plus a webhook signing secret. You need all five values.

| # | Credential | What it's for | Where to find it |
|---|---|---|---|
| 1 | **App ID** | App-as-itself JWTs (webhooks, posting checks, App-token-based git clone) | Top of settings page: `App ID: 1234567` |
| 2 | **Private key** | Pairs with App ID — signs the JWTs | "Private keys" → **Generate a private key** → `.pem` downloads (e.g. `~/Downloads/octopus-ai-demo.2026-05-14.private-key.pem`) |
| 3 | **Client ID** | App-on-behalf-of-user OAuth flow ("Sign in with GitHub" / "Connect" handshake) | "About" subsection: `Client ID: Iv23liABCDEF…` (starts with `Iv23li` or `Iv1.`) |
| 4 | **Client secret** | Pairs with Client ID — exchanges auth code for user access token | "Client secrets" → **Generate a new client secret** → shown **once**, copy immediately |
| 5 | **Webhook secret** | HMAC-signs the JSON payloads GitHub POSTs to `/api/github/webhook` so Octopus can verify they're authentic | "Webhook" → **Secret** field. Generate with `openssl rand -hex 32`; paste into both the GitHub form AND Databricks (step 6) |

### Why both App credentials AND OAuth credentials?

The App identity (App ID + Private key) lets Octopus act AS THE APP — receiving
webhooks, posting check-runs, cloning via an installation token. The OAuth
identity (Client ID + Client secret) lets Octopus identify the human user
when they click **Connect GitHub** in the dashboard, so it knows which user
just authorized the install.

When you ticked **Request user authorization (OAuth) during installation**
in step 1, GitHub started generating OAuth credentials too. They live under
**About** (Client ID) and **Client secrets** (Client secret).

### Quick visual map of the App settings page

```
https://github.com/settings/apps/octopus-ai-demo
├── General
│   ├── About
│   │   ├── App ID:       1234567                  ← step 5.1
│   │   └── Client ID:    Iv23liABCDEF…            ← step 5.3
│   ├── Identifying and authorizing users
│   │   └── Callback URL (set in step 1)
│   ├── Webhook
│   │   ├── Webhook URL   (set in step 1)
│   │   └── Webhook secret …                       ← step 5.5
│   └── Private keys
│       └── Generate a private key (.pem download)  ← step 5.2
├── Permissions & events (set in steps 2 + 3)
└── Client secrets
    └── Generate a new client secret               ← step 5.4
```

---

## 6. Push the five secrets to Databricks

Run on your laptop, with the Databricks CLI authenticated as
`octopus-ai`:

```bash
# 1. Webhook secret — if you generated above, paste it here
echo -n "<webhook-secret-from-step-5>" | \
  databricks secrets put-secret octopus-octopus-ai github_webhook_secret \
  --profile octopus-ai

# 2. App ID
echo -n "<APP_ID>" | \
  databricks secrets put-secret octopus-octopus-ai github_app_id \
  --profile octopus-ai

# 3. OAuth Client ID
echo -n "<CLIENT_ID>" | \
  databricks secrets put-secret octopus-octopus-ai github_client_id \
  --profile octopus-ai

# 4. OAuth Client Secret
echo -n "<CLIENT_SECRET>" | \
  databricks secrets put-secret octopus-octopus-ai github_client_secret \
  --profile octopus-ai

# 5. Private key (.pem file from step 5)
databricks secrets put-secret octopus-octopus-ai github_app_private_key \
  --profile octopus-ai \
  --string-value "$(cat ~/Downloads/octopus-ai-demo.*.private-key.pem)"
```

> Each command replaces the placeholder value pushed during initial deploy.
> The App reads the new value at startup, so a redeploy is required after
> this step.

---

## 7. Redeploy the app to pick up the new secrets

The Lakebase + VS + Model Serving infra all stay as-is. Only the App
container needs to restart to read the new env vars:

```bash
cd /Users/dermot.smyth/dev/workspaces/octopus
databricks apps deploy octopus \
  --source-code-path /Workspace/Users/dermot.smyth@databricks.com/octopus-app-source \
  --profile octopus-ai
```

After ~30 s the deployment finishes and the app restarts. You can confirm via:

```bash
databricks apps get octopus --profile octopus-ai | jq '.active_deployment.status'
```

---

## 8. Install the App on a repo + connect through the dashboard

1. In Octopus dashboard, click **Connect GitHub**.
2. You'll be sent to
   `https://github.com/apps/octopus-ai-demo/installations/new?state=...`
3. Pick the account or org that owns the repo you want to demo with.
4. Choose **All repositories** for the easiest first-run, or **Only select
   repositories** and pick one.
5. Click **Install & Authorize**.
6. You're redirected back to Octopus. The dashboard's "Get started"
   checklist should now show ✅ for "Connect GitHub" and your selected
   repo(s) should appear under **Repositories**.

---

## 9. Trigger the first PR review

1. Pick a small test repo (anything < 200 files) from your installed list.
2. Click into it from Octopus → wait for the initial indexing to finish
   (you'll see chunk-count grow in real-time).
3. On GitHub, open a PR against that repo. Even a small one (add a TODO,
   change a comment) is fine for the first run.
4. Within ~60–90 s the PR should get an inline review comment from
   `octopus-ai-demo[bot]`.

Watch logs in real time while the review is processing:

```bash
databricks apps logs octopus --profile octopus-ai
```

You'll see entries like:

```
[github] webhook received: pull_request.opened repo=<owner>/<repo> pr=#1
[queue] enqueued process-review job=...
[reviewer] starting review for PR #1
[ai-router] anthropic via octopus-claude-octopus-ai
[reviewer] posted 3 inline comments, 0 critical
```

---

## 10. Rotating credentials later

Should you ever need to roll any of the five secrets (key compromise, rotation
policy, etc.):

```bash
# Generate + push new webhook secret, then update GitHub App settings to match
NEW=$(openssl rand -hex 32)
echo -n "$NEW" | databricks secrets put-secret octopus-octopus-ai github_webhook_secret --profile octopus-ai
# ...then paste $NEW into github.com/settings/apps/octopus-ai-demo → Webhook → secret

# Regenerate private key in GitHub UI, download new .pem, then:
databricks secrets put-secret octopus-octopus-ai github_app_private_key \
  --profile octopus-ai \
  --string-value "$(cat path/to/new.pem)"

# Then redeploy to pick up:
databricks apps deploy octopus \
  --source-code-path /Workspace/Users/dermot.smyth@databricks.com/octopus-app-source \
  --profile octopus-ai
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Connect GitHub` button → GitHub 404 page | App slug in `NEXT_PUBLIC_GITHUB_APP_SLUG` doesn't match an App that exists. Verify the App name in github.com matches `octopus-ai-demo` exactly. |
| Webhook delivery shows `403` in GitHub UI | Webhook secret in GitHub ≠ secret in Databricks. Re-run step 6.1, then update GitHub UI to match. |
| App installed but no comment on PR | Check `databricks apps logs octopus` for queue / reviewer entries. Usually means private key is malformed (missing newlines) or wrong App ID. Re-run step 6.2 and 6.5. |
| Repos page is empty after install | `installation` webhook didn't reach the app. Check GitHub App settings → **Advanced** → **Recent Deliveries** for delivery attempts. Click any failed delivery → **Redeliver**. |
| `permission denied for table installations` in logs | App SP missing GRANT — re-run `bun packages/db/scripts/grant-app-sp-perms.ts`. |

---

## Reference

- App slug env var: `NEXT_PUBLIC_GITHUB_APP_SLUG` in `databricks/app/app.yaml`
- Secrets scope: `octopus-octopus-ai`
- Webhook handler: `apps/web/app/api/github/webhook/route.ts`
- OAuth callback handler: `apps/web/app/api/github/callback/route.ts`
- Reviewer entry point: `apps/web/lib/reviewer.ts`
