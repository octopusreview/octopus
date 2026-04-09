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
  default = [
    {
      description = "HTTP"
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    },
    {
      description = "HTTPS"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    },
  ]
}

variable "docker_compose_content" {
  description = "Contents of the docker-compose.yml to be written on the instance."
  type        = string
  default     = ""
}

variable "env_content" {
  description = "Contents of the .env file to be written on the instance."
  type        = string
  sensitive   = true
  default     = ""
}

variable "app_domain" {
  description = "Public domain name for the application (used in TLS / caddy config)."
  type        = string
  default     = ""
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
