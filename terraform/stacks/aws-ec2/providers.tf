provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "octopus"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
