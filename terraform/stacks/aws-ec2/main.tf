locals {
  db_url = "postgresql://${module.rds.username}:${urlencode(var.db_password)}@${module.rds.endpoint}/${module.rds.db_name}?sslmode=require"

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

  env_content = <<-ENV
    # Database
    DATABASE_URL=${local.db_url}

    # Better Auth
    BETTER_AUTH_SECRET=${var.better_auth_secret}
    BETTER_AUTH_URL=https://${var.app_domain}

    # App
    NEXT_PUBLIC_APP_URL=https://${var.app_domain}
    ADMIN_EMAILS=${var.admin_emails}

    # Qdrant (Vector DB) — internal Docker network
    QDRANT_URL=http://qdrant:6333

    %{~ if var.enable_redis}
    # Redis
    REDIS_URL=${local.redis_url}
    %{~ endif}

    # GitHub App
    GITHUB_APP_ID=${var.github_app_id}
    GITHUB_APP_PRIVATE_KEY=${var.github_app_private_key}
    GITHUB_WEBHOOK_SECRET=${var.github_webhook_secret}
    NEXT_PUBLIC_GITHUB_APP_SLUG=${var.github_app_slug}

    # GitHub OAuth
    GITHUB_CLIENT_ID=${var.github_client_id}
    GITHUB_CLIENT_SECRET=${var.github_client_secret}

    # Google OAuth
    GOOGLE_CLIENT_ID=${var.google_client_id}
    GOOGLE_CLIENT_SECRET=${var.google_client_secret}

    # LLM Providers
    OPENAI_API_KEY=${var.openai_api_key}
    ANTHROPIC_API_KEY=${var.anthropic_api_key}
    COHERE_API_KEY=${var.cohere_api_key}

    # Email
    RESEND_API_KEY=${var.resend_api_key}
    EMAIL_FROM=${var.email_from}

    # Pubby (Real-time)
    PUBBY_APP_ID=${var.pubby_app_id}
    PUBBY_APP_KEY=${var.pubby_app_key}
    PUBBY_APP_SECRET=${var.pubby_app_secret}
    NEXT_PUBLIC_PUBBY_KEY=${var.pubby_app_key}

    # OAuth redirect URIs
    BITBUCKET_REDIRECT_URI=https://${var.app_domain}/api/bitbucket/callback
    LINEAR_REDIRECT_URI=https://${var.app_domain}/api/linear/callback
    SLACK_REDIRECT_URI=https://${var.app_domain}/api/slack/callback
  ENV

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

  ssh_ingress_rule = var.key_name != null ? [
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

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────
# Using VPC CIDR (not EC2 SG) to avoid a circular dependency between rds and ec2 modules.
# Only EC2 instances within this VPC can reach the RDS instance.
module "rds" {
  source = "../../modules/aws/rds-postgres"

  name_prefix          = var.name_prefix
  vpc_id               = module.vpc.vpc_id
  subnet_ids           = module.vpc.private_subnet_ids
  allowed_cidr_blocks  = [var.vpc_cidr]
  db_password          = var.db_password
  instance_class       = var.db_instance_class
  allocated_storage_gb = var.db_allocated_storage_gb
  multi_az             = var.db_multi_az
  deletion_protection  = var.db_deletion_protection
  tags                 = var.tags
}

# ── ElastiCache Redis (optional) ──────────────────────────────────────────────
module "redis" {
  count  = var.enable_redis ? 1 : 0
  source = "../../modules/aws/elasticache-redis"

  name_prefix         = var.name_prefix
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.private_subnet_ids
  allowed_cidr_blocks = [var.vpc_cidr]
  node_type           = var.redis_node_type
  tags                = var.tags
}

# ── EC2 Application ───────────────────────────────────────────────────────────
module "ec2" {
  source = "../../modules/aws/ec2-app"

  name_prefix            = var.name_prefix
  vpc_id                 = module.vpc.vpc_id
  subnet_id              = module.vpc.public_subnet_ids[0]
  instance_type          = var.instance_type
  ami_id                 = var.ami_id
  key_name               = var.key_name
  root_volume_size_gb    = var.root_volume_size_gb
  create_eip             = var.create_eip
  app_domain             = var.app_domain
  ecr_registry_url       = var.ecr_registry_url
  docker_compose_content = local.docker_compose
  env_content            = local.env_content
  nginx_conf_content     = local.nginx_conf
  proxy_params_content   = local.proxy_params

  ingress_rules = local.ingress_rules

  tags = var.tags
}
