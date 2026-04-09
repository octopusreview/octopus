# ── AWS ───────────────────────────────────────────────────────────────────────
variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (e.g. production, staging)."
  type        = string
  default     = "production"
}

variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"
}

# ── Networking ────────────────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid CIDR block (e.g. 10.0.0.0/16)."
  }
}

variable "enable_nat_gateway" {
  description = "Create a NAT Gateway so private subnets can reach the internet."
  type        = bool
  default     = false
}

# ── EC2 ───────────────────────────────────────────────────────────────────────
variable "instance_type" {
  description = "EC2 instance type. Minimum recommended: t3.xlarge (4 vCPU, 16 GB)."
  type        = string
  default     = "t3.xlarge"
}

variable "ami_id" {
  description = "Custom AMI ID. Defaults to the latest Ubuntu 24.04 LTS if empty."
  type        = string
  default     = ""
}

variable "key_name" {
  description = "Name of an existing EC2 key pair for SSH access. Leave null to disable."
  type        = string
  default     = null
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GB."
  type        = number
  default     = 100

  validation {
    condition     = var.root_volume_size_gb >= 20
    error_message = "root_volume_size_gb must be at least 20 GB."
  }
}

variable "create_eip" {
  description = "Allocate and associate an Elastic IP to the EC2 instance."
  type        = bool
  default     = true
}

# ── Application ───────────────────────────────────────────────────────────────
variable "app_image" {
  description = "Docker image for the Octopus web application (e.g. ghcr.io/org/octopus:latest)."
  type        = string
}

variable "app_domain" {
  description = "Public domain name pointing to the EC2 instance (e.g. octopus.example.com)."
  type        = string
}

# ── Database ──────────────────────────────────────────────────────────────────
variable "db_password" {
  description = "Master password for the RDS PostgreSQL instance."
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t3.medium"

  validation {
    condition     = startswith(var.db_instance_class, "db.")
    error_message = "db_instance_class must be a valid RDS instance class starting with 'db.' (e.g. db.t3.medium)."
  }
}

variable "db_allocated_storage_gb" {
  description = "Allocated storage in GB for RDS."
  type        = number
  default     = 50

  validation {
    condition     = var.db_allocated_storage_gb >= 20
    error_message = "db_allocated_storage_gb must be at least 20 GB (RDS minimum for PostgreSQL)."
  }
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for the RDS instance."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Prevent accidental deletion of the RDS instance."
  type        = bool
  default     = true
}

# ── SSH ───────────────────────────────────────────────────────────────────────
variable "ssh_cidr_blocks" {
  description = "CIDR blocks allowed to reach port 22. Ignored when key_name is null. Restrict to your IP for security (e.g. [\"203.0.113.5/32\"])."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ── Registry ──────────────────────────────────────────────────────────────────
variable "ecr_registry_url" {
  description = "AWS ECR registry URL for ECR-hosted images (e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com). Leave empty for public images or non-ECR registries."
  type        = string
  default     = ""
}

# ── Redis ─────────────────────────────────────────────────────────────────────
variable "enable_redis" {
  description = "Create an ElastiCache Redis cluster."
  type        = bool
  default     = false
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t3.micro"
}

# ── Auth ──────────────────────────────────────────────────────────────────────
variable "better_auth_secret" {
  description = "Secret key for Better Auth session signing (min 32 chars). Generate: openssl rand -hex 32"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.better_auth_secret) >= 32
    error_message = "better_auth_secret must be at least 32 characters. Generate one with: openssl rand -hex 32"
  }
}

# ── GitHub App ────────────────────────────────────────────────────────────────
variable "github_app_id" {
  description = "GitHub App ID."
  type        = string
  default     = ""
}

variable "github_app_private_key" {
  description = "GitHub App private key (PEM format)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_webhook_secret" {
  description = "GitHub webhook secret for request validation."
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_app_slug" {
  description = "GitHub App slug (NEXT_PUBLIC_GITHUB_APP_SLUG)."
  type        = string
  default     = ""
}

variable "github_client_id" {
  description = "GitHub OAuth App client ID."
  type        = string
  default     = ""
}

variable "github_client_secret" {
  description = "GitHub OAuth App client secret."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Google OAuth ──────────────────────────────────────────────────────────────
variable "google_client_id" {
  description = "Google OAuth client ID."
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret."
  type        = string
  sensitive   = true
  default     = ""
}

# ── LLM ───────────────────────────────────────────────────────────────────────
variable "openai_api_key" {
  description = "OpenAI API key for embeddings and completions."
  type        = string
  sensitive   = true
  default     = ""
}

variable "anthropic_api_key" {
  description = "Anthropic API key for Claude models."
  type        = string
  sensitive   = true
  default     = ""
}

variable "cohere_api_key" {
  description = "Cohere API key for reranking."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Email ─────────────────────────────────────────────────────────────────────
variable "resend_api_key" {
  description = "Resend API key for transactional emails."
  type        = string
  sensitive   = true
  default     = ""
}

variable "email_from" {
  description = "Default sender address for transactional emails."
  type        = string
  default     = "noreply@example.com"
}

# ── Pubby (Real-time) ─────────────────────────────────────────────────────────
variable "pubby_app_id" {
  description = "Pubby application ID."
  type        = string
  default     = ""
}

variable "pubby_app_key" {
  description = "Pubby application key (NEXT_PUBLIC_PUBBY_KEY)."
  type        = string
  default     = ""
}

variable "pubby_app_secret" {
  description = "Pubby application secret."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Admin ─────────────────────────────────────────────────────────────────────
variable "admin_emails" {
  description = "Comma-separated list of admin email addresses."
  type        = string
  default     = ""
}

# ── Tags ──────────────────────────────────────────────────────────────────────
variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
