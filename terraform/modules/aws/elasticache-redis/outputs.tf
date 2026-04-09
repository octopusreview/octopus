output "primary_endpoint_address" {
  description = "DNS name of the primary cache node."
  value       = aws_elasticache_cluster.this.cache_nodes[0].address
}

output "port" {
  description = "Port number of the Redis cluster."
  value       = aws_elasticache_cluster.this.port
}

output "connection_url" {
  description = "Redis connection URL (redis://host:port)."
  value       = "redis://${aws_elasticache_cluster.this.cache_nodes[0].address}:${aws_elasticache_cluster.this.port}"
}

output "security_group_id" {
  description = "ID of the Redis security group."
  value       = aws_security_group.this.id
}
