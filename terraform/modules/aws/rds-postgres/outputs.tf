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

output "security_group_id" {
  description = "ID of the RDS security group."
  value       = aws_security_group.this.id
}
