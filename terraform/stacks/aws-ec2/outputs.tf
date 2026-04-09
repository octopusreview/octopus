output "public_ip" {
  description = "Public IP address of the Octopus server."
  value       = module.ec2.public_ip
}

output "instance_id" {
  description = "EC2 instance ID."
  value       = module.ec2.instance_id
}

output "db_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)."
  value       = module.rds.endpoint
}

output "redis_url" {
  description = "Redis connection URL (empty if Redis is disabled)."
  value       = var.enable_redis ? module.redis[0].connection_url : ""
}

output "app_url" {
  description = "Application URL. Point your DNS A record to public_ip."
  value       = "https://${var.app_domain}"
}

output "vpc_id" {
  description = "ID of the created VPC."
  value       = module.vpc.vpc_id
}
