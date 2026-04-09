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

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [Docker](https://docs.docker.com/get-docker/) (to build and push the app image)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) — run `aws configure` with your access key and secret
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
   - **Webhook URL**: `https://your-domain.com/api/github/webhook`
   - **Webhook secret**: generate with `openssl rand -hex 20` and save it
3. Under **Permissions**, set:
   - Repository: **Contents** → Read-only
   - Repository: **Pull requests** → Read & Write
   - Repository: **Metadata** → Read-only (auto-selected)
   - Repository: **Issues** → Read & Write
4. Under **Subscribe to events**, check: **Pull request**, **Issue comment**, **Installation**
5. **Where can this app be installed?** → Any account (or Only on this account)
6. Click **Create GitHub App**
7. On the next page, note the **App ID** (a number like `123456`)
8. Scroll down → **Generate a private key** → a `.pem` file downloads
9. Convert the key to a single-line string for Terraform:
   ```bash
   awk 'NF {printf "%s\\n", $0}' ~/Downloads/your-app-name.pem
   ```
   Copy the output — it should look like: `"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n"`
10. Find your app's **slug** from the URL: `github.com/apps/your-slug` → the slug is `your-slug`
11. Click **Install App** → select the repositories Octopus should review

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
| `db_password` | Run: `openssl rand -base64 24 \| tr -d '/+=' \| cut -c1-24` |
| `better_auth_secret` | Run: `openssl rand -hex 32` |
| `github_app_id` | From Step 2A (the number) |
| `github_app_private_key` | The single-line PEM from Step 2A |
| `github_webhook_secret` | The secret you set in the GitHub App webhook |
| `github_app_slug` | From Step 2A |
| `github_client_id` | From Step 2B |
| `github_client_secret` | From Step 2B |
| `openai_api_key` or `anthropic_api_key` | At least one LLM key required |
| `admin_emails` | Your email — gets admin access on first login |

---

## Step 4 — Deploy

```bash
# Initialize Terraform (downloads the AWS provider)
terraform init

# Preview what will be created
terraform plan

# Create all resources (~5–8 minutes)
terraform apply
```

When `apply` finishes, you'll see output like:

```
public_ip  = "54.123.45.67"
app_url    = "https://octopus.example.com"
```

---

## Step 5 — Point DNS

Create an **A record** in your DNS provider:

```
octopus.example.com  →  A  →  <public_ip from apply output>
```

The app responds on port 80 immediately after the EC2 instance finishes booting (2–3 minutes after `apply`).

---

## Step 6 — Set up HTTPS

The server listens on HTTP (port 80). To serve HTTPS, the easiest option is **Cloudflare** (free plan):

1. Add your domain to Cloudflare (free plan is fine)
2. Create the DNS A record in Cloudflare (same as Step 5) — make sure the cloud icon is **orange** (proxied)
3. In Cloudflare: **SSL/TLS** → set mode to **Full** (not Full Strict, since nginx uses plain HTTP)
4. Done — Cloudflare terminates TLS for you at no cost

Alternatively:
- **AWS ALB + ACM**: more involved, requires a separate load balancer module
- **Caddy sidecar**: add a Caddy container to the docker-compose template with a volume for certs

---

## Step 7 — Run database migrations

On first deploy, run Prisma migrations before the app serves traffic.

**If you enabled SSH** (`key_name` is set in tfvars):
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
| RDS | db.t3.medium, single-AZ | $50 |
| EBS | 100 GB gp3 | $8 |
| Elastic IP | (always attached) | $0 |
| Data transfer | ~50 GB out | $5 |
| **Total** | | **~$183/mo** |

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

> Terraform re-apply does **not** replace the instance — the `ignore_changes` lifecycle rule on `user_data` prevents that. Only new deployments get updated userdata.

---

## Instance Sizing

| Team size | Instance | RDS | Notes |
|-----------|----------|-----|-------|
| 1–5 devs  | t3.xlarge | db.t3.medium | Default — minimum recommended |
| 5–20 devs | t3.2xlarge | db.t3.large | Scale up as load grows |
| 20+ devs  | c5.2xlarge | db.t3.xlarge | Consider `db_multi_az = true` |

The web process needs at least 4 GB RAM. With Qdrant and nginx, plan for 8 GB total minimum.

---

## Remote State (optional)

For team use, store Terraform state in S3:

```bash
cp backend.conf.example backend.conf
# Edit backend.conf with your S3 bucket and DynamoDB table
terraform init -backend-config=backend.conf
```

The `backend.conf.example` file includes the AWS CLI commands to create the bucket and lock table.

---

## Security Notes

- RDS is in private subnets — not reachable from the internet
- IMDSv2 enforced on EC2 (prevents SSRF credential theft)
- Root EBS volume encrypted at rest
- `.env` file on the instance is `chmod 600`
- Never commit `terraform.tfvars` — it's gitignored

---

## Directory Layout

```
terraform/
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
