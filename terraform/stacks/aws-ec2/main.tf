locals {
  redis_url = var.enable_redis ? module.redis[0].connection_url : ""

  # Production nginx.conf — both upstreams point to the web container.
  # Webhook and heavy CLI routes keep their own location blocks so they
  # can be redirected to a separate review-engine container in the future.
  nginx_conf = <<-NGINX
    worker_processes auto;

    events {
      worker_connections 1024;
    }

    http {
      proxy_connect_timeout 10s;
      proxy_read_timeout 900s;
      proxy_send_timeout 900s;

      add_header X-Content-Type-Options "nosniff" always;
      add_header X-Frame-Options "SAMEORIGIN" always;
      add_header Referrer-Policy "strict-origin-when-cross-origin" always;

      server {
        listen 80;

        resolver 127.0.0.11 valid=10s ipv6=off;

        set $web_upstream http://web:3000;

        location /api/github/webhook {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location /api/bitbucket/webhook {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location ~ ^/api/cli/[^/]+/review$ {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location ~ ^/api/cli/[^/]+/local-review$ {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location ~ ^/api/cli/[^/]+/index$ {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location ~ ^/api/cli/[^/]+/analyze$ {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location /api/github-action/ {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
        }

        location / {
          proxy_pass $web_upstream;
          include /etc/nginx/proxy_params;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_buffering off;
        }
      }
    }
  NGINX

  proxy_params = <<-PROXY
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  PROXY

  runtime_environment = merge({
    BETTER_AUTH_URL             = "https://${var.app_domain}"
    NEXT_PUBLIC_APP_URL         = "https://${var.app_domain}"
    ADMIN_EMAILS                = var.admin_emails
    QDRANT_URL                  = "http://qdrant:6333"
    GITHUB_APP_ID               = var.github_app_id
    GITHUB_APP_CLIENT_ID        = var.github_app_client_id
    NEXT_PUBLIC_GITHUB_APP_SLUG = var.github_app_slug
    GITHUB_CLIENT_ID            = var.github_client_id
    GOOGLE_CLIENT_ID            = var.google_client_id
    EMAIL_FROM                  = var.email_from
    PUBBY_APP_ID                = var.pubby_app_id
    PUBBY_APP_KEY               = var.pubby_app_key
    NEXT_PUBLIC_PUBBY_KEY       = var.pubby_app_key
    BITBUCKET_REDIRECT_URI      = "https://${var.app_domain}/api/bitbucket/callback"
    LINEAR_REDIRECT_URI         = "https://${var.app_domain}/api/linear/callback"
    SLACK_REDIRECT_URI          = "https://${var.app_domain}/api/slack/callback"
  }, var.enable_redis ? { REDIS_URL = local.redis_url } : {})

  database_config = {
    host     = module.rds.host
    port     = module.rds.port
    database = module.rds.db_name
  }

  docker_compose = templatefile("${path.module}/templates/docker-compose.yml.tpl", {
    app_image = var.app_image
  })

  # Ingress rules: always open 80 + 443; add SSH only when a key pair is configured.
  # Defined as a local to keep types consistent for concat().
  base_ingress_rules = [
    {
      description     = "HTTP"
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      cidr_blocks     = ["0.0.0.0/0"]
      security_groups = []
    },
    {
      description     = "HTTPS"
      from_port       = 443
      to_port         = 443
      protocol        = "tcp"
      cidr_blocks     = ["0.0.0.0/0"]
      security_groups = []
    },
  ]

  ssh_ingress_rule = var.key_name != null && length(var.ssh_cidr_blocks) > 0 ? [
    {
      description     = "SSH"
      from_port       = 22
      to_port         = 22
      protocol        = "tcp"
      cidr_blocks     = var.ssh_cidr_blocks
      security_groups = []
    }
  ] : []

  ingress_rules = concat(local.base_ingress_rules, local.ssh_ingress_rule)
}

# ── VPC ───────────────────────────────────────────────────────────────────────
module "vpc" {
  source = "../../modules/aws/vpc"

  name_prefix        = var.name_prefix
  cidr_block         = var.vpc_cidr
  enable_nat_gateway = var.enable_nat_gateway
  tags               = var.tags
}

# Identity-only security group for application access to private data services.
# It intentionally grants no ingress or egress by itself; the EC2 app security
# group retains the workload's network rules, while this group is only a stable
# source identity for RDS and Redis ingress.
resource "aws_security_group" "app_data_access" {
  name_prefix = "${var.name_prefix}-app-data-"
  description = "Octopus application identity for private data-service access"
  vpc_id      = module.vpc.vpc_id

  lifecycle {
    create_before_destroy = true
  }

  tags = merge({ Name = "${var.name_prefix}-app-data-sg" }, var.tags)
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────
module "rds" {
  source = "../../modules/aws/rds-postgres"

  name_prefix                    = var.name_prefix
  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnet_ids
  allowed_security_group_ids     = [aws_security_group.app_data_access.id]
  allowed_cidr_blocks            = var.restrict_data_access_to_app ? [] : [var.vpc_cidr]
  master_user_secret_kms_key_arn = var.db_secret_kms_key_arn
  manage_master_user_password    = var.runtime_secret_cutover_stage == "enforced"
  instance_class                 = var.db_instance_class
  allocated_storage_gb           = var.db_allocated_storage_gb
  multi_az                       = var.db_multi_az
  deletion_protection            = var.db_deletion_protection
  tags                           = var.tags
}

# ── ElastiCache Redis (optional) ──────────────────────────────────────────────
module "redis" {
  count  = var.enable_redis ? 1 : 0
  source = "../../modules/aws/elasticache-redis"

  name_prefix                = var.name_prefix
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [aws_security_group.app_data_access.id]
  allowed_cidr_blocks        = var.restrict_data_access_to_app ? [] : [var.vpc_cidr]
  node_type                  = var.redis_node_type
  tags                       = var.tags
}

# ── EC2 Application ───────────────────────────────────────────────────────────
module "ec2" {
  source = "../../modules/aws/ec2-app"

  name_prefix                   = var.name_prefix
  vpc_id                        = module.vpc.vpc_id
  subnet_id                     = module.vpc.public_subnet_ids[0]
  instance_type                 = var.instance_type
  ami_id                        = var.ami_id
  key_name                      = var.key_name
  root_volume_size_gb           = var.root_volume_size_gb
  create_eip                    = var.create_eip
  aws_region                    = var.aws_region
  ecr_registry_url              = var.ecr_registry_url
  docker_compose_content        = local.docker_compose
  nginx_conf_content            = local.nginx_conf
  proxy_params_content          = local.proxy_params
  application_secret_arn        = var.application_secret_arn
  database_secret_arn           = var.runtime_secret_cutover_stage == "enforced" ? module.rds.master_user_secret_arn : ""
  runtime_secret_preflight_only = var.runtime_secret_cutover_stage == "preflight"
  runtime_secret_kms_key_arns = distinct(compact([
    var.application_secret_kms_key_arn,
    var.runtime_secret_cutover_stage == "enforced" ? var.db_secret_kms_key_arn : "",
  ]))
  runtime_environment = local.runtime_environment
  database_config     = local.database_config

  ingress_rules                 = local.ingress_rules
  additional_security_group_ids = [aws_security_group.app_data_access.id]

  tags = var.tags
}
