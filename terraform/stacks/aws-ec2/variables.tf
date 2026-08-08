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

variable "restrict_data_access_to_app" {
  description = "Restrict RDS and Redis ingress to the EC2 application identity. Keep true for new deployments. Existing deployments must perform the documented two-stage cutover before their first restricted apply."
  type        = bool
  default     = true
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

variable "application_secret_arn" {
  description = "Exact ARN of a pre-provisioned Secrets Manager JSON secret containing application secret values. Terraform never reads its value."
  type        = string

  validation {
    condition = try(
      can(regex("^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", var.application_secret_arn)) &&
      split(":", var.application_secret_arn)[3] == var.aws_region,
      false
    )
    error_message = "application_secret_arn must be a complete Secrets Manager secret ARN in aws_region."
  }
}

variable "application_secret_kms_key_arn" {
  description = "Optional customer-managed KMS key ARN used by application_secret_arn. Leave empty when the secret uses the AWS managed key."
  type        = string
  default     = ""

  validation {
    condition = (
      var.application_secret_kms_key_arn == "" ||
      try(
        can(regex("^arn:[^:]+:kms:[^:]+:[0-9]{12}:key/[A-Za-z0-9-]+$", var.application_secret_kms_key_arn)) &&
        split(":", var.application_secret_kms_key_arn)[3] == var.aws_region,
        false
      )
    )
    error_message = "application_secret_kms_key_arn must be empty or a customer-managed KMS key ARN."
  }
}

variable "runtime_secret_cutover_stage" {
  description = "Runtime secret rollout stage. Existing stacks must apply preflight before enforced; new stacks use enforced."
  type        = string

  validation {
    condition     = contains(["preflight", "enforced"], var.runtime_secret_cutover_stage)
    error_message = "runtime_secret_cutover_stage must be either preflight or enforced."
  }
}

# ── Database ──────────────────────────────────────────────────────────────────
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

variable "db_secret_kms_key_arn" {
  description = "Optional customer-managed KMS key ARN for the RDS-managed master-user secret. Leave empty to use the AWS managed key."
  type        = string
  default     = ""

  validation {
    condition = (
      var.db_secret_kms_key_arn == "" ||
      try(
        can(regex("^arn:[^:]+:kms:[^:]+:[0-9]{12}:key/[A-Za-z0-9-]+$", var.db_secret_kms_key_arn)) &&
        split(":", var.db_secret_kms_key_arn)[3] == var.aws_region,
        false
      )
    )
    error_message = "db_secret_kms_key_arn must be empty or a customer-managed KMS key ARN."
  }
}

# ── SSH ───────────────────────────────────────────────────────────────────────
variable "ssh_cidr_blocks" {
  description = "CIDR blocks allowed to reach port 22 when key_name is set. Leave empty to keep SSH unreachable; explicitly restrict access to trusted IPs (e.g. [\"203.0.113.5/32\"])."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for cidr in var.ssh_cidr_blocks :
      try(cidrnetmask(cidr) != "" && cidrsubnet(cidr, 0, 0) != "0.0.0.0/0", false)
    ])
    error_message = "Every ssh_cidr_blocks entry must be a valid IPv4 CIDR narrower than 0.0.0.0/0. Public SSH from the entire internet is not supported."
  }
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

# ── GitHub App ────────────────────────────────────────────────────────────────
variable "github_app_id" {
  description = "GitHub App ID."
  type        = string
  default     = ""
}

variable "github_app_slug" {
  description = "GitHub App slug (NEXT_PUBLIC_GITHUB_APP_SLUG)."
  type        = string
  default     = ""
}

variable "github_app_client_id" {
  description = "GitHub App client ID used to verify the installing user."
  type        = string
  default     = ""
}

variable "github_client_id" {
  description = "GitHub OAuth App client ID."
  type        = string
  default     = ""
}

# ── Google OAuth ──────────────────────────────────────────────────────────────
variable "google_client_id" {
  description = "Google OAuth client ID."
  type        = string
  default     = ""
}

# ── Email ─────────────────────────────────────────────────────────────────────
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
