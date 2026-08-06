terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Production state can contain generated credentials. Keep encryption and
  # native S3 locking mandatory; supply only deployment-specific identifiers
  # through backend.conf (see backend.conf.example).
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
