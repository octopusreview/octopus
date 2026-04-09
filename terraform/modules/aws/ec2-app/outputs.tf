output "instance_id" {
  description = "ID of the EC2 instance."
  value       = aws_instance.this.id
}

output "public_ip" {
  description = "Public IP of the instance (EIP if created, otherwise the auto-assigned IP)."
  value       = var.create_eip ? aws_eip.this[0].public_ip : aws_instance.this.public_ip
}

output "private_ip" {
  description = "Private IP address of the instance."
  value       = aws_instance.this.private_ip
}

output "security_group_id" {
  description = "ID of the application security group."
  value       = aws_security_group.this.id
}

output "iam_role_name" {
  description = "Name of the IAM role attached to the instance."
  value       = aws_iam_role.this.name
}

output "iam_role_arn" {
  description = "ARN of the IAM role attached to the instance."
  value       = aws_iam_role.this.arn
}
