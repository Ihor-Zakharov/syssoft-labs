terraform {
  required_version = ">= 1.10"

  # State and its lock live in HCP Terraform (free, no card). Execution mode is "Local": HCP only stores state,
  # plan/apply run on this PC or in GitHub Actions with short-lived OIDC credentials — HCP never gets AWS keys.
  cloud {
    organization = "zakharov-syssoft"

    workspaces {
      name = "syssoft-labs-aws-bootstrap"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      Stack     = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
