locals {
  redis_url          = var.enable_redis ? module.redis[0].connection_url : ""
  origin_name_suffix = substr(sha256(var.name_prefix), 0, 12)
  origin_lb_name     = "oct-origin-${local.origin_name_suffix}"
  origin_tg_name     = "oct-app-${local.origin_name_suffix}"

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

      # The ALB is the only trusted proxy after origin enforcement. During the
      # preflight compatibility window, direct internet clients can still reach
      # nginx, so preserve X-Forwarded-Proto only for VPC-sourced requests.
      geo $trusted_origin_proxy {
        default 0;
        ${var.vpc_cidr} 1;
      }

      map "$trusted_origin_proxy:$http_x_forwarded_proto" $forwarded_proto {
        default $scheme;
        "1:https" https;
      }

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
    proxy_set_header X-Forwarded-Proto $forwarded_proto;
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
    app_image           = var.app_image
    nginx_config_sha256 = sha256("${local.nginx_conf}\n${local.proxy_params}")
  })

  # Existing stacks retain their pre-cutover public ingress only during
  # preflight: direct HTTP, plus HTTPS because operator-managed instance TLS
  # (Caddy, an nginx certificate) may still be the live Full (strict) origin.
  # The stack-managed nginx has no local certificate, so port 443 is inert
  # unless the operator terminates TLS on the instance. Enforcement removes
  # both after the managed HTTPS origin is healthy.
  legacy_origin_ingress_rules = var.origin_tls_cutover_stage == "preflight" ? [
    {
      description     = "Legacy public HTTP during origin TLS preflight"
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      cidr_blocks     = ["0.0.0.0/0"]
      security_groups = []
    },
    {
      description     = "Legacy public HTTPS during origin TLS preflight"
      from_port       = 443
      to_port         = 443
      protocol        = "tcp"
      cidr_blocks     = ["0.0.0.0/0"]
      security_groups = []
    },
  ] : []

  managed_origin_ingress_rule = [
    {
      description     = "HTTP from managed origin load balancer"
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      cidr_blocks     = []
      security_groups = [aws_security_group.origin_edge.id]
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

  ingress_rules = concat(
    local.legacy_origin_ingress_rules,
    local.managed_origin_ingress_rule,
    local.ssh_ingress_rule,
  )
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

# Dedicated public edge for authenticated TLS termination. The security group
# has no implicit public rule: callers must originate from a configured trusted
# edge CIDR, and egress is separately constrained to the application SG.
resource "aws_security_group" "origin_edge" {
  name_prefix = "${var.name_prefix}-origin-edge-"
  description = "Trusted edge access to the Octopus HTTPS origin"
  vpc_id      = module.vpc.vpc_id

  lifecycle {
    create_before_destroy = true
  }

  tags = merge({ Name = "${var.name_prefix}-origin-edge-sg" }, var.tags)
}

resource "aws_vpc_security_group_ingress_rule" "origin_https" {
  for_each = toset(var.trusted_edge_ipv4_cidrs)

  security_group_id = aws_security_group.origin_edge.id
  description       = "HTTPS from trusted edge ${each.value}"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

resource "aws_lb" "origin" {
  name                       = local.origin_lb_name
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.origin_edge.id]
  subnets                    = module.vpc.public_subnet_ids
  ip_address_type            = "ipv4"
  idle_timeout               = 900
  preserve_host_header       = true
  drop_invalid_header_fields = true

  tags = merge({ Name = "${var.name_prefix}-origin" }, var.tags)

  depends_on = [
    module.vpc,
    aws_vpc_security_group_ingress_rule.origin_https,
  ]
}

resource "aws_lb_target_group" "app" {
  name                 = local.origin_tg_name
  port                 = 80
  protocol             = "HTTP"
  protocol_version     = "HTTP1"
  target_type          = "instance"
  vpc_id               = module.vpc.vpc_id
  deregistration_delay = 900

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = merge({ Name = "${var.name_prefix}-app-origin" }, var.tags)
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.origin.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.origin_tls_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  tags = merge({ Name = "${var.name_prefix}-origin-https" }, var.tags)
}

# Cloudflare address ranges are shared across customers. This Host gate rejects
# unintended virtual hosts but is not tenant authentication: deployments that
# require cryptographic zone ownership must add per-hostname custom AOP/mTLS.
resource "aws_lb_listener_rule" "app_host" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [var.app_domain]
    }
  }

  tags = merge({ Name = "${var.name_prefix}-origin-app-host" }, var.tags)
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

# Keep the load-balancer security group free of its default allow-all egress.
# This separate rule avoids a dependency cycle while constraining the only
# origin path to the EC2 application security group on HTTP port 80.
resource "aws_vpc_security_group_egress_rule" "origin_to_app" {
  security_group_id            = aws_security_group.origin_edge.id
  description                  = "HTTP to Octopus application targets"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = module.ec2.security_group_id
}

resource "aws_lb_target_group_attachment" "app" {
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = module.ec2.instance_id
  port             = 80

  depends_on = [aws_vpc_security_group_egress_rule.origin_to_app]
}
