resource "aws_elasticache_subnet_group" "this" {
  name        = "${var.name_prefix}-redis"
  subnet_ids  = var.subnet_ids
  description = "Octopus ElastiCache subnet group"

  tags = merge({ Name = "${var.name_prefix}-redis-subnet-group" }, var.tags)
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-redis-"
  vpc_id      = var.vpc_id
  description = "Octopus Redis security group"

  dynamic "ingress" {
    for_each = length(var.allowed_security_group_ids) > 0 ? [1] : []
    content {
      description     = "Redis from app security group"
      from_port       = 6379
      to_port         = 6379
      protocol        = "tcp"
      security_groups = var.allowed_security_group_ids
    }
  }

  dynamic "ingress" {
    for_each = length(var.allowed_cidr_blocks) > 0 ? [1] : []
    content {
      description = "Redis from VPC CIDR"
      from_port   = 6379
      to_port     = 6379
      protocol    = "tcp"
      cidr_blocks = var.allowed_cidr_blocks
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = merge({ Name = "${var.name_prefix}-redis-sg" }, var.tags)
}

resource "aws_elasticache_cluster" "this" {
  cluster_id        = "${var.name_prefix}-redis"
  engine            = "redis"
  node_type         = var.node_type
  num_cache_nodes   = var.num_cache_nodes
  engine_version    = var.engine_version
  port              = 6379

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.this.id]

  apply_immediately = true

  tags = merge({ Name = "${var.name_prefix}-redis" }, var.tags)
}
