variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"
}

variable "vpc_id" {
  description = "ID of the VPC in which to launch the instance."
  type        = string
}

variable "subnet_id" {
  description = "ID of the public subnet for the EC2 instance."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type. Minimum recommended: t3.xlarge (4 vCPU, 16 GB) for small teams."
  type        = string
  default     = "t3.xlarge"
}

variable "ami_id" {
  description = "Custom AMI ID. Defaults to the latest Ubuntu 24.04 LTS if empty."
  type        = string
  default     = ""
}

variable "key_name" {
  description = "Name of an existing EC2 key pair for SSH access. Leave empty to disable SSH."
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
  description = "Allocate and associate an Elastic IP to the instance."
  type        = bool
  default     = true
}

variable "ingress_rules" {
  description = "List of ingress rules for the application security group."
  type = list(object({
    description     = string
    from_port       = number
    to_port         = number
    protocol        = string
    cidr_blocks     = optional(list(string), [])
    security_groups = optional(list(string), [])
  }))
  default = []
}

variable "additional_security_group_ids" {
  description = "Additional security group IDs to attach to the application instance, such as identity-only groups for private service access."
  type        = list(string)
  default     = []
}

variable "docker_compose_content" {
  description = "Contents of the docker-compose.yml to be written on the instance."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region containing the runtime secrets."
  type        = string
}

variable "application_secret_arn" {
  description = "Exact ARN of the pre-provisioned JSON secret containing Octopus application secrets."
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

variable "database_secret_arn" {
  description = "Exact ARN of the RDS-managed master-user secret. May be empty only during runtime-secret preflight."
  type        = string
  default     = ""

  validation {
    condition = try(
      var.runtime_secret_preflight_only ?
      var.database_secret_arn == "" || (
        can(regex("^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.!@-]+$", var.database_secret_arn)) &&
        split(":", var.database_secret_arn)[3] == var.aws_region
        ) : (
        can(regex("^arn:[^:]+:secretsmanager:[^:]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.!@-]+$", var.database_secret_arn)) &&
        split(":", var.database_secret_arn)[3] == var.aws_region
      ),
      false
    )
    error_message = "database_secret_arn must be a complete Secrets Manager secret ARN in aws_region unless runtime_secret_preflight_only is true."
  }
}

variable "runtime_secret_preflight_only" {
  description = "Run read-only application-secret and Compose compatibility checks without installing runtime secret delivery."
  type        = bool
  default     = false
}

variable "runtime_secret_kms_key_arns" {
  description = "Exact customer-managed KMS key ARNs used by the runtime secrets. AWS-managed Secrets Manager keys need no entry."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.runtime_secret_kms_key_arns :
      try(
        can(regex("^arn:[^:]+:kms:[^:]+:[0-9]{12}:key/[A-Za-z0-9-]+$", arn)) &&
        split(":", arn)[3] == var.aws_region,
        false
      )
    ])
    error_message = "Every runtime_secret_kms_key_arns entry must be a customer-managed KMS key ARN."
  }
}

variable "runtime_environment" {
  description = "Non-secret environment values combined with runtime secrets on the instance."
  type        = map(string)
  default     = {}
}

variable "database_config" {
  description = "Non-secret RDS connection metadata used to construct DATABASE_URL at runtime."
  type = object({
    host     = string
    port     = number
    database = string
  })
}

variable "ecr_registry_url" {
  description = "AWS ECR registry URL (e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com). Set to authenticate before pulling images. Leave empty for public images or non-ECR registries."
  type        = string
  default     = ""
}

variable "nginx_conf_content" {
  description = "Contents of nginx.conf to be written on the instance."
  type        = string
  default     = ""
}

variable "proxy_params_content" {
  description = "Contents of the nginx proxy_params file to be written on the instance."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
