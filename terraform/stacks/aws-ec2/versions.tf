terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.100.0"
    }
  }

  # Keep encryption and native S3 locking mandatory; supply only
  # deployment-specific identifiers through backend.conf.
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}
