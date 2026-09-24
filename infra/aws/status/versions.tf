terraform {
  required_version = ">= 1.10"

  # State in HCP Terraform, execution mode Local (see ../bootstrap/versions.tf)
  cloud {
    organization = "zakharov-syssoft"

    workspaces {
      name = "syssoft-labs-aws-status"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      Stack     = "status"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
