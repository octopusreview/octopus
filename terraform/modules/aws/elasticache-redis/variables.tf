variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{0,33}$", var.name_prefix)) &&
      !endswith(var.name_prefix, "-") &&
      !strcontains(var.name_prefix, "--")
    )
    error_message = "name_prefix must be 1-34 lowercase letters, digits, or hyphens, start with a letter, and contain no trailing or consecutive hyphen."
  }
}

variable "vpc_id" {
  description = "ID of the VPC in which to create the Redis cluster."
  type        = string
}

variable "subnet_ids" {
  description = "List of private subnet IDs for the ElastiCache subnet group."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security group IDs permitted to connect on port 6379 (e.g. the EC2 app SG)."
  type        = list(string)
  default     = []
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks permitted to connect on port 6379 (e.g. the VPC CIDR)."
  type        = list(string)
  default     = []
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t3.micro"
}

variable "engine_version" {
  description = "Redis engine version."
  type        = string
  default     = "7.1"

  validation {
    condition     = try(tonumber(split(".", var.engine_version)[0]) >= 7, false)
    error_message = "engine_version must be Redis OSS 7.0 or newer because the least-privilege RBAC policy uses ACL selectors."
  }
}

variable "num_cache_nodes" {
  description = "Number of cache clusters in the replication group (1 = single-node, no replica)."
  type        = number
  default     = 1
}

variable "redis_auth_secret_arn" {
  description = "ARN of the dedicated Secrets Manager secret whose SecretString contains exactly a password field for the Redis app user. Terraform never reads the secret value."
  type        = string

  validation {
    condition     = can(regex("^arn:[^:]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[^:]+$", var.redis_auth_secret_arn))
    error_message = "redis_auth_secret_arn must be a complete Secrets Manager secret ARN without a version suffix."
  }
}

variable "redis_auth_secret_version_ids" {
  description = "One active Secrets Manager version ID, or two exact version IDs during password rotation. Values identify versions only; passwords never enter Terraform."
  type        = list(string)

  validation {
    condition = (
      length(var.redis_auth_secret_version_ids) >= 1 &&
      length(var.redis_auth_secret_version_ids) <= 2 &&
      length(distinct(var.redis_auth_secret_version_ids)) == length(var.redis_auth_secret_version_ids) &&
      alltrue([
        for version_id in var.redis_auth_secret_version_ids :
        can(regex("^[A-Za-z0-9-]{32,64}$", version_id))
      ])
    )
    error_message = "redis_auth_secret_version_ids must contain one or two distinct exact Secrets Manager version IDs (32-64 letters, digits, or hyphens)."
  }
}

variable "redis_auth_secret_kms_key_arn" {
  description = "Optional exact customer-managed KMS key ARN used by redis_auth_secret_arn. Leave empty when the secret uses the AWS managed Secrets Manager key."
  type        = string
  default     = ""

  validation {
    condition = (
      var.redis_auth_secret_kms_key_arn == "" ||
      can(regex("^arn:[^:]+:kms:[a-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$", var.redis_auth_secret_kms_key_arn))
    )
    error_message = "redis_auth_secret_kms_key_arn must be empty or a complete customer-managed KMS key ARN."
  }
}

variable "redis_auth_cutover_stage" {
  description = "Redis authentication cutover: preflight keeps the built-in passwordless default alongside the authenticated app user; enforced replaces it with a disabled default user."
  type        = string

  validation {
    condition     = contains(["preflight", "enforced"], var.redis_auth_cutover_stage)
    error_message = "redis_auth_cutover_stage must be either preflight or enforced."
  }
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
