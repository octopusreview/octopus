variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"
}

variable "cidr_block" {
  description = "The IPv4 CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "enable_nat_gateway" {
  description = "Create a NAT Gateway so private subnets can reach the internet."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
