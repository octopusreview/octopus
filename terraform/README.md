# Octopus — Terraform

Production-ready infrastructure for self-hosting Octopus on AWS.

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
            │ EIP
        Internet
```

**What runs on EC2 (Docker Compose):**
- `nginx` — reverse proxy routing webhooks and CLI traffic
- `web` — the Octopus Next.js application
- `qdrant` — vector database for code embeddings

**Managed services:**
- **RDS PostgreSQL 17** — application database (replaces the local postgres container)
- **ElastiCache Redis** — optional, for session caching and background job queues

## Quick Start

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS credentials configured (`aws configure` or environment variables)
- A Docker image of Octopus pushed to a registry (build from the root Dockerfile)
- A registered domain with DNS access

### 1. Build and push the Docker image

Build the image from the repository root and push it to a registry. Choose one of the options below.

**Option A — GitHub Container Registry (GHCR)**

```bash
# Authenticate (one-time; requires a GitHub Personal Access Token with write:packages)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build and push
docker build -t ghcr.io/YOUR_ORG/octopus:latest -f apps/web/Dockerfile .
docker push ghcr.io/YOUR_ORG/octopus:latest
```

Set `app_image = "ghcr.io/YOUR_ORG/octopus:latest"` in `terraform.tfvars`.

**Option B — AWS Elastic Container Registry (ECR)**

```bash
# Create the repository (one-time)
aws ecr create-repository --repository-name octopus --region us-east-1

# Authenticate
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
      123456789012.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t 123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest \
  -f apps/web/Dockerfile .
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest
```

Set `app_image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/octopus:latest"` and
`ecr_registry_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com"` in `terraform.tfvars`
(the EC2 instance will authenticate automatically via its IAM role).

**Option C — Docker Hub**

```bash
docker build -t youruser/octopus:latest -f apps/web/Dockerfile .
docker push youruser/octopus:latest
```

Set `app_image = "youruser/octopus:latest"` in `terraform.tfvars`.

### 2. Choose a deployment path

| Path | When to use |
|------|-------------|
| `stacks/aws-ec2/` | **Recommended for all real deployments.** Full control over every variable, supports remote state, suitable for production. |
| `examples/aws-ec2/` | Quick evaluation only. Minimal wrapper with hard-coded defaults — not intended for production use. |

### 3. Configure variables

```bash
cd terraform/stacks/aws-ec2
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — fill in all REQUIRED values at the top of the file
```

### 4. (Optional) Configure remote state

```bash
cp backend.conf.example backend.conf
# Edit backend.conf with your S3 bucket details
terraform init -backend-config=backend.conf
```

Or use local state for simple setups:

```bash
terraform init
```

### 5. Deploy

```bash
terraform plan
terraform apply
```

### 6. Run database migrations

On first deploy (and after schema changes), migrations must be run before the application serves traffic. SSH into the instance and run:

```bash
ssh -i your-key.pem ubuntu@<public_ip>
cd /opt/octopus

# Wait for the containers to start (usually 30–60 s after boot)
sudo docker compose ps

# Run Prisma migrations against the RDS instance
sudo docker compose run --rm web sh -c "cd /app && npx prisma migrate deploy"
```

> The `web` service container image includes the Next.js standalone output but not the Prisma CLI binary. If `npx prisma` is not found, run migrations locally pointing `DATABASE_URL` at the RDS endpoint, or add a dedicated migration step to your CI/CD pipeline.

### 7. Point DNS

After `apply` completes, copy the `public_ip` output and create an **A record** in your DNS provider:

```
octopus.example.com  A  <public_ip>
```

The application will be available at `http://<public_ip>` immediately (nginx listens on port 80). For HTTPS, add a TLS termination layer (AWS ALB, Caddy sidecar, or Cloudflare proxy).

## Directory Layout

```
terraform/
├── modules/
│   └── aws/
│       ├── vpc/              # VPC, subnets, IGW, NAT Gateway
│       ├── ec2-app/          # EC2, security group, IAM, EIP, userdata
│       ├── rds-postgres/     # RDS PostgreSQL 17
│       └── elasticache-redis/ # ElastiCache Redis (optional)
├── stacks/
│   └── aws-ec2/              # Full composition — use this for deployments
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       ├── providers.tf
│       ├── versions.tf
│       ├── templates/
│       │   └── docker-compose.yml.tpl
│       ├── terraform.tfvars.example
│       └── backend.conf.example
└── examples/
    └── aws-ec2/              # Minimal wrapper for quick evaluation
```

## Instance Sizing

| Team size | Instance type | RDS instance | Notes |
|-----------|---------------|--------------|-------|
| 1–5 devs  | t3.xlarge     | db.t3.micro  | Minimum viable |
| 5–20 devs | t3.2xlarge    | db.t3.medium | Recommended |
| 20+ devs  | c5.2xlarge    | db.t3.large  | Consider Multi-AZ RDS |

The Octopus web process requires at minimum 4 GB of memory (`NODE_OPTIONS=--max-old-space-size=4096`). Qdrant and nginx add ~1–2 GB, so instances with less than 8 GB total RAM are not recommended.

## Updating the Application

```bash
# Pull the latest image on the server
ssh -i your-key.pem ubuntu@<public_ip>
cd /opt/octopus
sudo docker compose pull
sudo docker compose up -d
```

Or re-apply Terraform after pushing a new image tag (the `user_data` `ignore_changes` lifecycle rule means the instance is **not** replaced on re-apply — only new instances get the updated userdata).

## Security Notes

- The RDS instance is placed in **private subnets** and is not publicly accessible.
- IMDSv2 is enforced on the EC2 instance.
- The root EBS volume is encrypted at rest.
- The `.env` file on the instance has `chmod 600`.
- `terraform.tfvars` is gitignored — never commit secrets.

## Variables Reference

See [`stacks/aws-ec2/variables.tf`](stacks/aws-ec2/variables.tf) for the full list of variables and their descriptions.
