variable "name_prefix" {
  description = "Prefix applied to every resource name."
  type        = string
  default     = "octopus"
}

variable "vpc_id" {
  description = "ID of the VPC in which to create the RDS instance."
  type        = string
}

variable "subnet_ids" {
  description = "List of private subnet IDs for the DB subnet group (minimum 2 AZs)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security group IDs permitted to connect on port 5432 (e.g. the EC2 app SG)."
  type        = list(string)
  default     = []
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks permitted to connect on port 5432 (e.g. the VPC CIDR)."
  type        = list(string)
  default     = []
}

variable "db_name" {
  description = "Name of the initial database."
  type        = string
  default     = "octopus"
}

variable "db_username" {
  description = "Master username for the RDS instance."
  type        = string
  default     = "octopus"
}

variable "db_password" {
  description = "Master password for the RDS instance."
  type        = string
  sensitive   = true
}

variable "instance_class" {
  description = "RDS instance class. Minimum recommended: db.t3.medium for small teams."
  type        = string
  default     = "db.t3.medium"
}

variable "allocated_storage_gb" {
  description = "Allocated storage in GB."
  type        = number
  default     = 50
}

variable "max_allocated_storage_gb" {
  description = "Upper limit for storage autoscaling in GB. Set to 0 to disable autoscaling."
  type        = number
  default     = 200
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment for high availability."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups (0 disables backups)."
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Preferred backup window in UTC (hh24:mi-hh24:mi)."
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "Preferred maintenance window."
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "deletion_protection" {
  description = "Prevent accidental deletion of the RDS instance."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip creating a final snapshot on deletion. Set to false in production."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
