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

```bash
# From the repository root
docker build -t ghcr.io/your-org/octopus:latest -f apps/web/Dockerfile .
docker push ghcr.io/your-org/octopus:latest
```

### 2. Configure variables

```bash
cd terraform/stacks/aws-ec2
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — fill in all required values
```

### 3. (Optional) Configure remote state

```bash
cp backend.conf.example backend.conf
# Edit backend.conf with your S3 bucket details
terraform init -backend-config=backend.conf
```

Or use local state for simple setups:

```bash
terraform init
```

### 4. Deploy

```bash
terraform plan
terraform apply
```

### 5. Point DNS

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
