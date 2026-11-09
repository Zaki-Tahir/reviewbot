terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "reviewbot"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_app_slug" {
  description = "Slug of the staging GitHub App"
  type        = string
}

variable "alarm_email" {
  type    = string
  default = ""
}

module "reviewbot" {
  source = "../../modules/reviewbot"

  name                   = "reviewbot-staging"
  environment            = "staging"
  lambda_dist_dir        = "${path.root}/../../../../apps/functions/dist"
  github_app_slug        = var.github_app_slug
  alarm_email            = var.alarm_email
  worker_max_concurrency = 3
  log_retention_days     = 14
}

output "dashboard_url" {
  value = module.reviewbot.dashboard_url
}

output "webhook_url" {
  value = module.reviewbot.webhook_url
}

output "oauth_callback_url" {
  value = module.reviewbot.oauth_callback_url
}

output "dashboard_bucket" {
  value = module.reviewbot.dashboard_bucket
}

output "cloudfront_distribution_id" {
  value = module.reviewbot.cloudfront_distribution_id
}

output "secret_name" {
  value = module.reviewbot.secret_name
}
