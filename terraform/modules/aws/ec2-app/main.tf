data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  refresh_secrets_script = templatefile("${path.module}/templates/refresh-secrets.sh.tpl", {
    aws_region_base64             = base64encode(var.aws_region)
    application_secret_arn_base64 = base64encode(var.application_secret_arn)
    database_secret_arn_base64    = base64encode(var.database_secret_arn)
    redis_secret_arn_base64       = base64encode(var.redis_secret_arn)
    public_environment_base64     = base64encode(jsonencode(var.runtime_environment))
    database_config_base64        = base64encode(jsonencode(var.database_config))
    redis_config_base64           = base64encode(jsonencode(var.redis_config))
    redis_probe_base64            = base64gzip(file("${path.module}/scripts/probe_redis.js"))
    redis_auth_enforced           = var.redis_auth_cutover_stage == "enforced" ? "1" : "0"
  })

  runtime_installer = templatefile("${path.module}/templates/runtime-installer.sh.tpl", {
    renderer_base64       = base64gzip(file("${path.module}/scripts/render_runtime_env.py"))
    refresh_script_base64 = base64gzip(local.refresh_secrets_script)
    docker_compose_base64 = base64gzip(var.docker_compose_content)
    nginx_conf_base64     = var.nginx_conf_content != "" ? base64gzip(var.nginx_conf_content) : ""
    proxy_params_base64   = var.proxy_params_content != "" ? base64gzip(var.proxy_params_content) : ""
  })

  runtime_secret_preflight = templatefile("${path.module}/templates/preflight-runtime-secrets.sh.tpl", {
    aws_region_base64             = base64encode(var.aws_region)
    application_secret_arn_base64 = base64encode(var.application_secret_arn)
    redis_secret_arn_base64       = base64encode(var.redis_secret_arn)
    renderer_base64               = base64gzip(file("${path.module}/scripts/render_runtime_env.py"))
    docker_compose_base64         = base64gzip(var.docker_compose_content)
  })

  runtime_secret_payload = var.runtime_secret_preflight_only ? local.runtime_secret_preflight : local.runtime_installer

  runtime_secret_policy_statements = concat(
    [{
      Sid      = "ReadRuntimeSecrets"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = compact([var.application_secret_arn, var.database_secret_arn, var.redis_secret_arn])
    }],
    length(var.runtime_secret_kms_key_arns) > 0 ? [{
      Sid      = "DecryptRuntimeSecrets"
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = var.runtime_secret_kms_key_arns
      Condition = {
        StringEquals = {
          "kms:ViaService" = "secretsmanager.${var.aws_region}.amazonaws.com"
        }
      }
    }] : []
  )
}

resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-app-"
  vpc_id      = var.vpc_id
  description = "Octopus application security group"

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      description     = ingress.value.description
      from_port       = ingress.value.from_port
      to_port         = ingress.value.to_port
      protocol        = ingress.value.protocol
      cidr_blocks     = ingress.value.cidr_blocks
      security_groups = ingress.value.security_groups
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

  tags = merge({ Name = "${var.name_prefix}-app-sg" }, var.tags)
}

resource "aws_iam_role" "this" {
  name_prefix = "${var.name_prefix}-ec2-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge({ Name = "${var.name_prefix}-ec2-role" }, var.tags)
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "runtime_secrets" {
  name_prefix = "${var.name_prefix}-runtime-secrets-"
  role        = aws_iam_role.this.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.runtime_secret_policy_statements
  })

  lifecycle {
    precondition {
      condition     = var.redis_config.enabled == (var.redis_secret_arn != "")
      error_message = "redis_secret_arn must be set exactly when redis_config.enabled is true."
    }
  }
}

resource "aws_iam_instance_profile" "this" {
  name_prefix = "${var.name_prefix}-ec2-"
  role        = aws_iam_role.this.name

  tags = merge({ Name = "${var.name_prefix}-ec2-profile" }, var.tags)
}

resource "aws_instance" "this" {
  ami                    = coalesce(var.ami_id, data.aws_ami.ubuntu.id)
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = concat([aws_security_group.this.id], var.additional_security_group_ids)
  iam_instance_profile   = aws_iam_instance_profile.this.name
  key_name               = var.key_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    delete_on_termination = true
    encrypted             = true
  }

  user_data_base64 = base64gzip(templatefile("${path.module}/templates/userdata.sh.tpl", {
    runtime_installer_base64 = base64gzip(local.runtime_installer)
    ecr_registry_url         = var.ecr_registry_url
  }))

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2
    http_put_response_hop_limit = 1
  }

  tags = merge({ Name = "${var.name_prefix}-app" }, var.tags)

  lifecycle {
    # Ignore both forms so upgrading an instance created by the former
    # user_data argument cannot trigger a stop/start. SSM performs the update.
    ignore_changes = [ami, user_data, user_data_base64]
  }

  # User data fetches secrets and may authenticate to ECR immediately. Ensure
  # every required role permission is attached before the instance boots.
  depends_on = [
    aws_iam_role_policy.runtime_secrets,
    aws_iam_role_policy_attachment.ssm,
    aws_iam_role_policy_attachment.ecr_read,
  ]
}

resource "aws_ssm_document" "runtime_secrets" {
  name            = "${var.name_prefix}-install-runtime-secrets"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description = (
      var.runtime_secret_preflight_only ?
      "Preflight Octopus runtime secret delivery" :
      "Install and refresh Octopus runtime secret delivery"
    )
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "installRuntimeSecretDelivery"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [
          "set -eu",
          "umask 077",
          "if command -v cloud-init >/dev/null 2>&1; then cloud-init status --wait; fi",
          "installer_path=$(mktemp /run/octopus-runtime-installer.XXXXXX)",
          "trap 'rm -f -- \"$installer_path\"' EXIT",
          "printf '%s' '${base64gzip(local.runtime_secret_payload)}' | base64 --decode | gzip -d > \"$installer_path\"",
          "chmod 0700 \"$installer_path\"",
          "/bin/bash \"$installer_path\"",
        ]
      }
    }]
  })

  tags = merge({ Name = "${var.name_prefix}-runtime-secrets" }, var.tags)
}

# Updating EC2 user data does not rerun cloud-init on an existing instance. The
# association installs the same runtime loader in place and waits for success.
resource "aws_ssm_association" "runtime_secrets" {
  name                             = aws_ssm_document.runtime_secrets.name
  association_name                 = "${var.name_prefix}-runtime-secrets"
  document_version                 = aws_ssm_document.runtime_secrets.default_version
  wait_for_success_timeout_seconds = 900

  targets {
    key    = "InstanceIds"
    values = [aws_instance.this.id]
  }

  depends_on = [
    aws_iam_role_policy.runtime_secrets,
    aws_iam_role_policy_attachment.ssm,
    aws_iam_role_policy_attachment.ecr_read,
  ]
}

resource "aws_eip" "this" {
  count = var.create_eip ? 1 : 0

  instance = aws_instance.this.id
  domain   = "vpc"

  tags = merge({ Name = "${var.name_prefix}-app-eip" }, var.tags)
}
