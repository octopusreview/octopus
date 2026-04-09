output "primary_endpoint_address" {
  description = "DNS name of the primary Redis node."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Port number of the Redis cluster."
  value       = aws_elasticache_replication_group.this.port
}

output "connection_url" {
  description = "Redis connection URL. Uses rediss:// (TLS) because transit_encryption_enabled = true."
  value       = "rediss://${aws_elasticache_replication_group.this.primary_endpoint_address}:${aws_elasticache_replication_group.this.port}"
}

output "security_group_id" {
  description = "ID of the Redis security group."
  value       = aws_security_group.this.id
}
