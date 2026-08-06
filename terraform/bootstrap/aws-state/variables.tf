variable "bucket_name" {
  description = "Globally unique S3 bucket name for the Octopus application state."
  type        = string

  validation {
    condition = (
      length(var.bucket_name) >= 3 &&
      length(var.bucket_name) <= 63 &&
      can(regex("^[a-z0-9][a-z0-9.-]*[a-z0-9]$", var.bucket_name)) &&
      !strcontains(var.bucket_name, "..") &&
      !can(regex("^[0-9]{1,3}(\\.[0-9]{1,3}){3}$", var.bucket_name))
    )
    error_message = "bucket_name must be a 3-63 character, lowercase DNS-compatible S3 bucket name, not an IPv4 address."
  }
}

variable "region" {
  description = "AWS region for the state bucket and KMS key."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.region))
    error_message = "region must be a valid AWS region name such as us-east-1."
  }
}

variable "expected_account_id" {
  description = "Twelve-digit AWS account that is allowed to receive the state boundary."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id must be a 12-digit AWS account ID."
  }
}

variable "state_key" {
  description = "Exact object key used by the Octopus application stack in the default Terraform workspace."
  type        = string
  default     = "aws-ec2/production/terraform.tfstate"

  validation {
    condition = (
      length(var.state_key) >= 3 &&
      length(var.state_key) <= 1024 &&
      can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$", var.state_key)) &&
      !startswith(var.state_key, "/") &&
      !endswith(var.state_key, "/") &&
      !strcontains(var.state_key, "//") &&
      !strcontains(var.state_key, "*") &&
      !strcontains(var.state_key, "?")
    )
    error_message = "state_key must be a literal, relative S3 object key without wildcards, repeated slashes, or control characters."
  }
}

variable "workspace_key_prefix" {
  description = "S3 key prefix for non-default Terraform workspaces."
  type        = string
  default     = "env:"

  validation {
    condition = (
      length(var.workspace_key_prefix) >= 1 &&
      length(var.workspace_key_prefix) <= 256 &&
      can(regex("^[A-Za-z0-9._:/-]+$", var.workspace_key_prefix)) &&
      !startswith(var.workspace_key_prefix, "/") &&
      !endswith(var.workspace_key_prefix, "/") &&
      !strcontains(var.workspace_key_prefix, "//") &&
      !strcontains(var.workspace_key_prefix, "*") &&
      !strcontains(var.workspace_key_prefix, "?")
    )
    error_message = "workspace_key_prefix must be a literal, relative S3 prefix without wildcards, repeated slashes, or control characters."
  }
}

variable "tags" {
  description = "Additional tags to apply to the state bucket and KMS key."
  type        = map(string)
  default     = {}
}
