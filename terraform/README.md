# Octopus — Terraform

Self-host Octopus on AWS with a single `terraform apply`. This sets up an EC2 instance running the Octopus app, an RDS PostgreSQL database, and optional ElastiCache Redis — all in a private VPC.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  VPC (10.0.0.0/16)                                       │
│                                                          │
│  Public subnet          Private subnets                  │
│  ┌────────────────┐     ┌───────────────────────────┐   │
│  │  EC2 (t3.xlarge│     │  RDS PostgreSQL 17         │   │
│  │                │────▶│  ElastiCache Redis (opt.)  │   │
│  │  nginx         │     └───────────────────────────┘   │
│  │  web (Next.js) │                                      │
│  │  qdrant        │                                      │
│  └────────┬───────┘                                      │
└───────────┼──────────────────────────────────────────────┘
            │ Elastic IP
        Internet
```

**What runs on EC2 (Docker Compose):** nginx + Octopus web app + Qdrant vector database

**Managed AWS services:** RDS PostgreSQL 17 (app database) · ElastiCache Redis (optional, for queues)

---

## Prerequisites

Install these before you start:

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.11
- [Docker](https://docs.docker.com/get-docker/) (to build and push the app image)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) — authenticate with an AWS SSO/profile session or an assigned role
- A registered domain (you'll point its DNS to the server IP after deploy)
- A GitHub account (to create the GitHub App and OAuth App)

---

## Step 1 — Build and push the Docker image

Build the Octopus image from the repository root and push it to a registry.

### Option A — GitHub Container Registry (GHCR) — recommended

```bash
# 1. Create a Personal Access Token (classic) at:
#    https://github.com/settings/tokens/new
#    Required scopes: write:packages, read:packages
export GITHUB_TOKEN=ghp_your_token_here

# 2. Log in to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 3. Build and push (run from the repo root)
docker build -t ghcr.io/YOUR_ORG_OR_USERNAME/octopus:latest -f apps/web/Dockerfile .
docker push ghcr.io/YOUR_ORG_OR_USERNAME/octopus:latest

# 4. Make the package public so the EC2 instance can pull it without auth:
#    https://github.com/YOUR_ORG_OR_USERNAME/octopus/settings/packages → Change visibility → Public
#    (Or use ECR below — EC2 authenticates automatically via IAM)
```

Set in `terraform.tfvars`: `app_image = "ghcr.io/YOUR_ORG_OR_USERNAME/octopus:latest"`

### Option B — AWS ECR (private, auth handled automatically)

```bash
# 1. Create the repository (one-time)
aws ecr create-repository --repository-name octopus --region us-east-1

# 2. Log in and push
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
      123456789012.dkr.ecr.us-east-1.amazonaws.com

docker build -t 123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest \
  -f apps/web/Dockerfile .
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest
```

Set in `terraform.tfvars`:
```
app_image        = "123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest"
ecr_registry_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com"
```

The EC2 instance authenticates to ECR automatically through its IAM role — no credentials needed.

---

## Step 2 — Create GitHub Apps

You need two separate GitHub apps: one for PR reviews and one for user login.

### Part A — GitHub App (PR reviews, webhooks)

1. Go to **https://github.com/settings/apps/new**
2. Fill in:
   - **GitHub App name**: e.g. `Octopus Review`
   - **Homepage URL**: `https://your-domain.com`
   - **Callback URL**: `https://your-domain.com/api/github/callback`
   - **Setup URL**: `https://your-domain.com/api/github/callback` (enable **Redirect on update**)
   - **Webhook URL**: `https://your-domain.com/api/github/webhook`
   - **Webhook secret**: generate with `openssl rand -hex 20` and save it
3. Under **Permissions**, set:
   - Repository: **Contents** → Read-only
   - Repository: **Pull requests** → Read & Write
   - Repository: **Checks** → Read & Write
   - Repository: **Metadata** → Read-only (auto-selected)
   - Repository: **Issues** → Read & Write
4. Under **Subscribe to events**, check: **Pull request**, **Issue comment**, **Installation**, **Installation repositories**
5. **Where can this app be installed?** → Any account (or Only on this account)
6. Click **Create GitHub App**
7. On the next page, note the **App ID** (a number like `123456`)
8. Note the **Client ID**, then generate and save a **client secret**. These
   GitHub App credentials verify that the installing user can access the
   claimed installation; they are not the login OAuth App credentials.
9. Scroll down → **Generate a private key** → a `.pem` file downloads. Keep it
   for the Secrets Manager application secret created in Step 3; never place it
   in Terraform variables.
10. Find your app's **slug** from the URL: `github.com/apps/your-slug` → the slug is `your-slug`
11. After deployment, start installation from Octopus → **Settings → Integrations**

### Part B — GitHub OAuth App (user login)

1. Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: e.g. `Octopus Login`
   - **Homepage URL**: `https://your-domain.com`
   - **Authorization callback URL**: `https://your-domain.com/api/auth/callback/github`
     ⚠️ Use exactly this path — it's handled by Better Auth internally
3. Click **Register application**
4. Note the **Client ID**, then click **Generate a new client secret** and save it

---

## Step 3 — Configure variables

### Create the application secret

Before running Terraform, create one Secrets Manager secret outside this
Terraform state. Its `SecretString` must be a JSON object.
`BETTER_AUTH_SECRET` and `GITHUB_STATE_SECRET` are required and must each be at
least 32 characters. The other keys are optional; when present,
`OCTOPUS_DATA_KEY` must be exactly 64 hexadecimal characters:

```json
{
  "BETTER_AUTH_SECRET": "generate-with-openssl-rand-base64-48",
  "GITHUB_STATE_SECRET": "generate-an-independent-secret-of-at-least-32-characters",
  "OCTOPUS_DATA_KEY": "64 hex characters; see existing-deployment note below",
  "GITHUB_APP_PRIVATE_KEY": "raw PEM or base64-encoded PEM",
  "GITHUB_WEBHOOK_SECRET": "...",
  "GITHUB_APP_CLIENT_SECRET": "...",
  "GITHUB_CLIENT_SECRET": "...",
  "GOOGLE_CLIENT_SECRET": "...",
  "OPENAI_API_KEY": "...",
  "ANTHROPIC_API_KEY": "...",
  "COHERE_API_KEY": "...",
  "RESEND_API_KEY": "...",
  "PUBBY_APP_SECRET": "..."
}
```

Generate the two required values independently; do not reuse one secret for
both purposes. For a new deployment, generate the optional data key with
`openssl rand -hex 32`. For an existing deployment with encrypted integration
credentials, preserve its legacy-derived data key by following the cutover
instructions below instead of generating a replacement.

Save the JSON in a root-only file outside the repository and pass the file to
`aws secretsmanager create-secret --secret-string file://...`. Do not put the
JSON directly on the command line or in `terraform.tfvars`. Record the exact
secret ARN, then securely remove the temporary file. Unknown JSON keys are
rejected by the runtime loader.

```bash
cd terraform/stacks/aws-ec2
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` and fill in the **REQUIRED** section at the top. The file has inline comments explaining each value.

The minimum you need to fill in:

| Variable | Where to get it |
|----------|----------------|
| `app_image` | The image URL from Step 1 |
| `app_domain` | Your domain (e.g. `octopus.example.com`) |
| `application_secret_arn` | Exact ARN of the JSON secret created above |
| `runtime_secret_cutover_stage` | `enforced` for a new deployment; existing AWS deployments must start with `preflight` as documented below |
| `github_app_id` | From Step 2A (the number) |
| `github_app_slug` | From Step 2A |
| `github_app_client_id` | GitHub App client ID from Step 2A |
| `github_client_id` | From Step 2B |
| `admin_emails` | Your email — gets admin access on first login |

In the `enforced` stage, RDS creates and manages its master password in Secrets
Manager, and the EC2 role can read exactly the application and database secret
ARNs. Secret values are fetched only on the instance, written atomically to
`/run/octopus/runtime.env` with mode `0600`, and refreshed every five minutes.
Docker Compose 2.30.0 or newer is required for the raw env-file format. Each
refresh is transactional: it retries transient Secrets Manager reads,
validates a candidate before normal promotion, and waits for container health.
If validation or recreation fails after a database rotation, the refresher
retains the current database candidate because RDS has already invalidated the
prior password. An application-only recreation failure restores the last-good
environment. Both paths exit unsuccessfully and leave a reconciliation stamp
so the timer retries instead of accepting a partial update. If a boot-time
refresh fails, the timer converges the complete Compose stack on recovery.

---

## Step 4 — Deploy

### Configure encrypted remote state

Production deployments require an existing private, versioned S3 bucket and a
customer-managed KMS key. The bucket must block public access, deny non-TLS
requests, and use the KMS key for default encryption. Give the Terraform
operator only these permissions:

- `s3:ListBucket` on the state bucket, restricted to the default state/lock
  keys and workspace prefix
- `s3:GetObject` and `s3:PutObject` on the default state object
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on non-default
  workspace state objects
- `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on `.tflock` objects
- `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`, and `kms:DescribeKey` on
  the configured key

Supply AWS credentials through a profile, environment, or role — never in the
backend configuration.

Create the boundary with the included bootstrap root. Its local state contains
no application secrets, but keep and back it up on an encrypted filesystem
because it controls the bucket and KMS key.

```bash
cd ../../bootstrap/aws-state
cp terraform.tfvars.example terraform.tfvars
# Set a globally unique bucket_name and the expected 12-digit AWS account ID.
# Confirm the account and region before continuing.
terraform init
terraform plan -out=backend.tfplan
terraform apply backend.tfplan

# Attach this least-privilege policy to the application Terraform operator.
terraform output -raw operator_iam_policy_json

umask 077
terraform output -raw backend_conf > ../../stacks/aws-ec2/backend.conf
cd ../../stacks/aws-ec2
```

If you use an existing bucket and KMS key instead, verify every control and IAM
permission above before copying `backend.conf.example`.

```bash
# The bootstrap generated backend.conf. If using an existing boundary, copy
# backend.conf.example and set every required deployment-specific value.
terraform init -backend-config=backend.conf
```

The backend block enforces encryption and native S3 state locking. The supplied
configuration also pins KMS and the expected AWS account; keep both settings.
Do not start an apply until initialization succeeds against that account.

For a new deployment, set `runtime_secret_cutover_stage = "enforced"` before
planning. The `preflight` stage is only for upgrading an existing AWS
deployment.

```bash
# Preview what will be created
terraform plan

# Create all resources (~5–8 minutes)
terraform apply
```

### Existing AWS deployments: stage the runtime-secret cutover

Existing AWS deployments also need a controlled runtime-secret cutover because
EC2 does not rerun changed user data and enabling the RDS-managed password
rotates the database credential immediately.

Run the following two runtime-secret stages in order. Keep
`restrict_data_access_to_app = false` during both stages so credential and
network changes are verified separately.

#### Stage 1 — preflight (no credential rotation)

1. Schedule a maintenance window and create `application_secret_arn` with the
   deployment's current application secret values, including both required
   secrets. Before any future `BETTER_AUTH_SECRET` rotation, add the
   legacy-equivalent `OCTOPUS_DATA_KEY` produced by
   `apps/web/scripts/print-data-key.ts` using the current auth secret and verify
   encrypted integrations still load.
2. Confirm the instance is online in SSM and record a current health check.
3. Set `runtime_secret_cutover_stage = "preflight"` and
   `restrict_data_access_to_app = false`, then review and apply the plan.
4. Confirm the SSM preflight succeeds. It checks the application-secret JSON
   schema and Docker Compose version (2.30.0 or newer) without changing runtime
   files or containers.

The preflight stage leaves the existing RDS credential unchanged and grants
EC2 read access only to the application secret and its configured KMS key.
Stop if SSM is offline, the plan proposes replacement/destruction, the
association fails, or the Compose version check fails. Upgrade Compose and
rerun `preflight`; do not continue to `enforced` until every check passes.

#### Stage 2 — enforced (activate managed runtime secrets)

1. Change only `runtime_secret_cutover_stage` to `"enforced"`; keep
   `restrict_data_access_to_app = false`.
2. Review the plan. It must enable the RDS-managed master password in place,
   add exact database-secret/KMS access for EC2, and replace the read-only
   preflight with the full runtime loader. It must not replace EC2, RDS, or
   Redis.
3. Apply. Terraform waits for cloud-init, then for SSM to install the loader,
   render and validate the candidate environment, and recreate the web
   container, including its health check. An application-only recreation
   failure restores the last-good environment. A database-credential
   validation or recreation failure retains the new candidate because RDS has
   invalidated the old password. Both leave the association failed and the
   timer armed to converge the full stack on a safe retry.
4. Verify `octopus-secrets.service`, `octopus-secrets.timer`, application
   health/version, database migrations, encrypted integrations, and one real
   review before continuing.

After the enforced cutover is healthy, rotate every old application credential
because prior state versions and old EC2 user data may retain the former
values. Rotate `BETTER_AUTH_SECRET` only after the data-key step above; the
rotation logs users out. Remove the unused legacy `/opt/octopus/.env` and clear
old cloud-init user-data copies only after verification and according to your
recovery policy.

Deployments created before the dedicated application identity must attach it before removing the legacy VPC-wide database/cache rule. For the first apply after upgrading, keep both paths temporarily:

Before planning, replace any legacy `ssh_cidr_blocks = ["0.0.0.0/0"]` value with trusted CIDRs (for example, one administrator `/32`) or `[]`; internet-wide SSH now fails validation.

```bash
terraform plan -var='restrict_data_access_to_app=false'
terraform apply -var='restrict_data_access_to_app=false'
```

Verify the running application can still reach PostgreSQL and Redis (when enabled). Then remove the temporary compatibility rule with the secure default:

```bash
terraform plan
terraform apply
```

The first plan must add the data-access security group and attach it to EC2 without replacing EC2, RDS, or Redis. The second must remove only the VPC-CIDR ingress rules. Stop if either plan proposes a managed data-resource replacement.

When `apply` finishes, you'll see output like:

```
public_ip  = "54.123.45.67"
app_url    = "https://octopus.example.com"
```

Terraform outputs the database secret ARN, never the database password. Read
or rotate secret values through Secrets Manager under your operational access
policy, not through Terraform outputs.

---

## Step 5 — Point DNS

Create an **A record** in your DNS provider:

```
octopus.example.com  →  A  →  <public_ip from apply output>
```

The app responds on port 80 immediately after the EC2 instance finishes booting (2–3 minutes after `apply`).

---

## Step 6 — Set up HTTPS

The default stack listens on HTTP (port 80). Before putting it into production,
add HTTPS at the origin using an AWS ALB with ACM, Caddy, or an nginx
certificate. Then configure Cloudflare for **Full (strict)** so both the
browser-to-edge and edge-to-origin connections are encrypted.

Cloudflare **Full** and **Full (strict)** require the origin to accept HTTPS;
they do not encrypt a plaintext HTTP origin. Cloudflare **Flexible** can proxy
this stack before origin TLS is installed, but the edge-to-origin connection
remains plaintext and is not recommended for production.

After origin HTTPS is configured:

1. Add the domain to Cloudflare and create the proxied DNS A record.
2. Select **SSL/TLS → Full (strict)**.
3. Verify the public URL and GitHub webhook delivery before removing any
   temporary HTTP compatibility path.

---

## Step 7 — Run database migrations

On first deploy, run Prisma migrations before the app serves traffic.

**If you enabled SSH** (`key_name` and trusted `ssh_cidr_blocks` are set in tfvars):
```bash
ssh -i your-key.pem ubuntu@<public_ip>
cd /opt/octopus
sudo docker compose ps           # wait until all containers show "Up"
sudo docker compose run --rm web sh -c "npx prisma migrate deploy"
```

**If SSH is disabled** (default — use AWS SSM Session Manager instead):
```bash
# Install the SSM plugin if needed: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
aws ssm start-session --target <instance_id from apply output>

# Then run the same commands
cd /opt/octopus
sudo docker compose run --rm web sh -c "npx prisma migrate deploy"
```

> If `npx prisma` is not found inside the container, run migrations locally by setting `DATABASE_URL` to the RDS endpoint and running `npx prisma migrate deploy` from your machine.

---

## Step 8 — Verify the deployment

1. Open `http://<public_ip>` (or `https://<domain>` if Cloudflare is set up) — you should see the login page
2. Click **Sign in with GitHub** and log in with the email in `admin_emails`
3. Go to **Settings** → **Integrations** — confirm the GitHub App is installed
4. Open a test PR in one of your repos and mention `@<github-app-slug>` in a comment — Octopus should post a review

---

## Troubleshooting

**Server not responding after apply**

The EC2 boot script runs on first startup (2–3 minutes). Check progress:
```bash
# SSH or SSM into the instance, then:
tail -f /var/log/octopus-setup.log
```

**App is up but shows errors**

```bash
cd /opt/octopus
sudo docker compose logs web     # app logs
sudo docker compose logs nginx   # proxy logs
sudo docker compose ps           # container status
```

**Database connection refused**

RDS takes 5–10 minutes to become available after `apply`. Check the RDS console or run:
```bash
sudo docker compose logs web 2>&1 | grep -i "database\|connect\|prisma"
```

**GitHub webhook not arriving**

- In your GitHub App settings → **Advanced** → check Recent Deliveries
- Confirm webhook URL is exactly `https://your-domain.com/api/github/webhook`
- Confirm HTTPS is working (webhook requires HTTPS)

**"Sign in with GitHub" fails**

The Authorization callback URL in your GitHub OAuth App must be exactly:
```
https://your-domain.com/api/auth/callback/github
```
Not `/api/github/callback` (that's a different route for App installation).

**Image pull failed on boot**

- GHCR: make sure the package is set to **Public** visibility
- ECR: make sure `ecr_registry_url` is set in tfvars and the region matches

---

## Estimated Monthly Cost

Running on default settings in `us-east-1`:

| Resource | Type | ~$/month |
|----------|------|----------|
| EC2 | t3.xlarge (on-demand) | $120 |
| RDS | db.t3.medium, single-AZ, 50 GB | $54 |
| EBS | 100 GB gp3 | $8 |
| Elastic IP | (always attached) | $0 |
| Data transfer | ~50 GB out | $5 |
| **Total** | | **~$187/mo** |

> Switching to Reserved Instances (1-year, no upfront) saves ~35% — roughly $65/mo.

---

## Updating the Application

After pushing a new image to your registry:

```bash
ssh -i your-key.pem ubuntu@<public_ip>   # or use SSM
cd /opt/octopus
sudo docker compose pull
sudo docker compose up -d
```

> Terraform re-apply does **not** replace the instance — the lifecycle rule
> ignores user-data drift. Runtime-loader changes still reach existing
> instances through the managed SSM association.

---

## Instance Sizing

| Team size | Instance | RDS | Notes |
|-----------|----------|-----|-------|
| 1–5 devs  | t3.xlarge | db.t3.medium | Default — minimum recommended |
| 5–20 devs | t3.2xlarge | db.t3.large | Scale up as load grows |
| 20+ devs  | c5.2xlarge | db.t3.xlarge | Consider `db_multi_az = true` |

The web container is allocated 5 GB RAM (4 GB for the Node.js heap). With Qdrant and nginx, plan for 8 GB total minimum.

---

## Migrating an existing local state

The repository previously defaulted to local state. Before checking out this
backend change, capture the authoritative inventory and backup in an exclusive
maintenance window. Do not allow concurrent Terraform operations until the
migration is verified.

```bash
# Run on the old configuration. Record every workspace, select each one, and
# repeat workspace show, state list, and state pull.
set -e
terraform workspace list
terraform workspace show
terraform state list
umask 077
OCTOPUS_STATE_WORKSPACE=$(terraform workspace show)
OCTOPUS_STATE_TEMP=$(mktemp "/encrypted/offline/path/octopus-${OCTOPUS_STATE_WORKSPACE}-XXXXXX")
OCTOPUS_STATE_BACKUP="${OCTOPUS_STATE_TEMP}.tfstate"
terraform state pull > "${OCTOPUS_STATE_TEMP}"
test -s "${OCTOPUS_STATE_TEMP}"
terraform show -json "${OCTOPUS_STATE_TEMP}" > /dev/null
mv "${OCTOPUS_STATE_TEMP}" "${OCTOPUS_STATE_BACKUP}"
shasum -a 256 "${OCTOPUS_STATE_BACKUP}"
```

After the backups and inventories are recorded, check out the new version and
run from `terraform/stacks/aws-ec2`:

```bash
# Generate backend.conf from the bootstrap root above, or copy the example and
# populate every value for a separately verified existing boundary.
test -s backend.conf
# If the old S3 backend uses DynamoDB locking and the old and new configurations
# have the identical bucket, key, and workspace prefix, keep its dynamodb_table
# setting here temporarily so old and upgraded clients share both locks.
terraform init -migrate-state -backend-config=backend.conf

# Confirm the migrated inventory, then require a non-destructive plan.
terraform workspace list
terraform workspace show
terraform state list
terraform plan
```

Create backups only on an encrypted filesystem outside the repository; set
`umask 077` before each file is created. If the authoritative state is
already remote, use that backend's documented recovery process. Compare every
workspace's pre-migration inventory with its migrated inventory. Select and
repeat `workspace show`, `state list`, and `plan` for every workspace. Stop if
initialization shows an empty or different state, or if any plan proposes an
unexpected create, destroy, or replacement. Do not use `-reconfigure` for the
first migration: it can select the new backend without copying the existing
state.

If the old backend used DynamoDB locking and the migration keeps the identical
bucket, key, and workspace prefix, keep `dynamodb_table` alongside the new
native S3 lock until every operator and automation client uses Terraform 1.11+
and this configuration. After confirming there are no old or active DynamoDB
locks, remove the setting, reinitialize the same S3 backend, verify all
workspace inventories and no-change plans again, and only then retire the lock
table.

If the bucket, key, or workspace prefix changes, the DynamoDB and native S3
locks do not coordinate. Drain every operator and automation client, then
revoke write and lock permissions for the old backend before migrating. Do not
restore those permissions or let an old configuration resume after cutover.

Keep the restricted backup until the remote state and a no-change plan are
verified. Then account for and securely remove obsolete local states, backups,
and saved plan files. Do not resume from a stale local copy. Prior S3 versions
are intentionally unavailable to the day-to-day operator: a bootstrap
administrator must temporarily attach the generated break-glass recovery
policy to retrieve a known-good version, then remove it. Rotate credentials
only if an old copy was exposed or cannot be accounted for, or as part of the
later secret-delivery cutover.

---

## Security Notes

- RDS is in private subnets — not reachable from the internet
- RDS and Redis (when enabled) accept traffic only from the identity-only data-access security group attached to the EC2 application, not the full VPC CIDR
- SSH is disabled by default; setting a key pair still requires explicit trusted CIDRs in `ssh_cidr_blocks`
- IMDSv2 enforced on EC2 (prevents SSRF credential theft)
- Root EBS volume encrypted at rest
- Terraform receives application secret ARNs, never application secret values
- RDS manages and rotates its master password in Secrets Manager
- Runtime values are fetched with exact IAM permissions and atomically written
  to `/run/octopus/runtime.env` with mode `0600`
- Never commit `terraform.tfvars` — it's gitignored
- Production state uses an encrypted, versioned S3 backend with native locking;
  backend credentials must never be stored in `backend.conf`
- Saved Terraform plans can contain plaintext secrets; always use a `.tfplan`
  filename so the repository ignore rules apply
- The default HTTP origin is not end-to-end encrypted; add origin TLS before
  using Cloudflare Full (strict) in production

---

## Directory Layout

```
terraform/
├── bootstrap/aws-state/   # one-time hardened S3/KMS state boundary
├── modules/aws/
│   ├── vpc/               # VPC, subnets, IGW, optional NAT
│   ├── ec2-app/           # EC2, security group, IAM, EIP, userdata
│   ├── rds-postgres/      # RDS PostgreSQL 17
│   └── elasticache-redis/ # ElastiCache Redis (optional)
├── stacks/aws-ec2/        # ← run terraform here for production deploys
│   ├── terraform.tfvars.example
│   ├── backend.conf.example
│   └── templates/docker-compose.yml.tpl
└── examples/aws-ec2/      # minimal wrapper for quick evaluation only
```

For production use, always run from `stacks/aws-ec2/`. The `examples/` directory is a minimal quickstart for evaluation only.
