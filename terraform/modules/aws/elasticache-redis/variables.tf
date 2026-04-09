variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"
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
}

variable "num_cache_nodes" {
  description = "Number of cache nodes (1 = no replication)."
  type        = number
  default     = 1
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
