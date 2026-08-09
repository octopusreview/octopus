output "primary_endpoint_address" {
  description = "DNS name of the primary Redis node."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Port number of the Redis cluster."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "ID of the Redis security group."
  value       = aws_security_group.this.id
}

output "application_username" {
  description = "Non-secret Redis username whose password is stored only in the dedicated Secrets Manager secret."
  value       = local.redis_auth_app_username
}

output "user_group_id" {
  description = "Stable ElastiCache user group ID attached in both authentication cutover stages."
  value       = local.redis_auth_user_group_id
}
