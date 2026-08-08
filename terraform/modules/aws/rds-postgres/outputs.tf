output "endpoint" {
  description = "Connection endpoint in host:port format."
  value       = aws_db_instance.this.endpoint
}

output "host" {
  description = "Hostname of the RDS instance."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Port number of the RDS instance."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Name of the created database."
  value       = aws_db_instance.this.db_name
}

output "username" {
  description = "Master username."
  value       = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed Secrets Manager secret containing the master credentials."
  value       = try(one(aws_db_instance.this.master_user_secret).secret_arn, null)
}

output "security_group_id" {
  description = "ID of the RDS security group."
  value       = aws_security_group.this.id
}
