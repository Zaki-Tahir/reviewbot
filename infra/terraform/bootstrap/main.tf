# One-time setup, applied by hand with admin credentials: lets GitHub Actions deploy each
# environment through OIDC, so no AWS keys are stored in GitHub.
#
#   cd infra/terraform/bootstrap
#   terraform init && terraform apply -var github_repository=owner/reviewbot

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_repository" {
  description = "owner/repo"
  type        = string
}

variable "environments" {
  type    = set(string)
  default = ["staging", "production"]
}

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust" {
  for_each = var.environments

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Only jobs that run in this repo's matching GitHub environment. Production can then require
    # a manual approval in GitHub before the role is usable.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each           = var.environments
  name               = "reviewbot-${each.key}-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust[each.key].json
}

# Terraform manages Lambda, API Gateway, DynamoDB, SQS, S3, CloudFront, CloudWatch and SNS.
resource "aws_iam_role_policy_attachment" "power_user" {
  for_each   = var.environments
  role       = aws_iam_role.deploy[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

# PowerUserAccess excludes IAM. Allow it only for this environment's own Lambda roles.
resource "aws_iam_role_policy" "iam_for_app_roles" {
  for_each = var.environments
  name     = "manage-reviewbot-roles"
  role     = aws_iam_role.deploy[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole", "iam:UpdateAssumeRolePolicy",
        "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
        "iam:ListInstanceProfilesForRole", "iam:PassRole",
      ]
      Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/reviewbot-${each.key}-*"
    }]
  })
}

output "deploy_role_arns" {
  description = "Save each as the AWS_DEPLOY_ROLE_ARN variable on the matching GitHub environment"
  value       = { for env, role in aws_iam_role.deploy : env => role.arn }
}
