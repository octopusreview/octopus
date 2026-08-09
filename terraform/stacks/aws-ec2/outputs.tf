output "public_ip" {
  description = "EC2 public IP retained for diagnostics and pre-enforcement HTTP recovery; never use it as a Full (strict) origin."
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

output "database_secret_arn" {
  description = "ARN of the RDS-managed master-user secret read by the EC2 instance role; null during preflight."
  value       = module.rds.master_user_secret_arn
}

output "redis_url" {
  description = "Redis connection URL (empty if Redis is disabled)."
  value       = var.enable_redis ? module.redis[0].connection_url : ""
}

output "app_url" {
  description = "Application URL served through the managed HTTPS origin."
  value       = "https://${var.app_domain}"
}

output "origin_dns_name" {
  description = "DNS name of the managed HTTPS origin load balancer."
  value       = aws_lb.origin.dns_name
}

output "origin_hosted_zone_id" {
  description = "Canonical hosted-zone ID of the managed HTTPS origin load balancer."
  value       = aws_lb.origin.zone_id
}

output "vpc_id" {
  description = "ID of the created VPC."
  value       = module.vpc.vpc_id
}
