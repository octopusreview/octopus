terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure after creating the S3 bucket and DynamoDB table.
  # See backend.conf.example for setup instructions.
  #
  # backend "s3" {}
}
