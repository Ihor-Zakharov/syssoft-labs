# GitHub Actions -> AWS without stored keys: a workflow gets a short-lived OIDC token from GitHub,
# AWS checks the token's signature and claims (repository, branch/event) and hands out temporary role credentials.

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  prefix     = var.project

  # Everything the deploy role may create is named "<prefix>-..."; its own roles are excluded below
  role_arn_pattern       = "arn:${local.partition}:iam::${local.account_id}:role/${local.prefix}-*"
  github_role_arn_prefix = "arn:${local.partition}:iam::${local.account_id}:role/${local.prefix}-gha-"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust_plan" {
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
    # Pull requests from this repository (fork PRs cannot request OIDC tokens) and any branch push
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "${var.github_oidc_subject}:pull_request",
        "${var.github_oidc_subject}:ref:refs/heads/*",
      ]
    }
  }
}

data "aws_iam_policy_document" "trust_deploy" {
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
    # Only workflows running on main can deploy
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_oidc_subject}:ref:refs/heads/main"]
    }
  }
}

# ---------------------------------------------------------------------------------------------------------------
# Plan role: read-only view of the account (state and its lock live in HCP Terraform)

resource "aws_iam_role" "plan" {
  name                 = "${local.prefix}-gha-plan"
  assume_role_policy   = data.aws_iam_policy_document.trust_plan.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}


# ---------------------------------------------------------------------------------------------------------------
# Permissions boundary: the most any role created by the deploy role can ever do,
# whatever policies get attached to it later (prevents privilege escalation through CreateRole)

data "aws_iam_policy_document" "boundary" {
  statement {
    sid       = "LambdaLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*:*"]
  }
  statement {
    sid = "OwnTables"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchWriteItem",
      "dynamodb:Query", "dynamodb:DescribeTable",
    ]
    resources = [
      "arn:${local.partition}:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*",
      "arn:${local.partition}:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*/index/*",
    ]
  }
  statement {
    sid       = "InvokeOwnFunctions"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:${local.partition}:lambda:${var.region}:${local.account_id}:function:${local.prefix}-*"]
  }
}

resource "aws_iam_policy" "boundary" {
  name        = "${local.prefix}-workload-boundary"
  description = "Upper limit for roles created by the ${local.prefix} deploy role"
  policy      = data.aws_iam_policy_document.boundary.json
}

# ---------------------------------------------------------------------------------------------------------------
# Deploy role: manages only "<prefix>-*" resources of the monitoring stack

resource "aws_iam_role" "deploy" {
  name                 = "${local.prefix}-gha-deploy"
  assume_role_policy   = data.aws_iam_policy_document.trust_deploy.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {

  statement {
    sid       = "Tables"
    actions   = ["dynamodb:*"]
    resources = ["arn:${local.partition}:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-*"]
  }
  statement {
    sid       = "Functions"
    actions   = ["lambda:*"]
    resources = ["arn:${local.partition}:lambda:${var.region}:${local.account_id}:function:${local.prefix}-*"]
  }
  statement {
    sid     = "Schedules"
    actions = ["scheduler:*"]
    resources = [
      "arn:${local.partition}:scheduler:${var.region}:${local.account_id}:schedule/*/${local.prefix}-*",
      "arn:${local.partition}:scheduler:${var.region}:${local.account_id}:schedule-group/${local.prefix}-*",
    ]
  }
  statement {
    sid       = "LogGroups"
    actions   = ["logs:*"]
    resources = ["arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*"]
  }
  statement {
    sid       = "DescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  # Roles for Lambda and Scheduler: may only be created with the boundary attached
  statement {
    sid       = "CreateBoundedRoles"
    actions   = ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:PutRolePermissionsBoundary"]
    resources = [local.role_arn_pattern]
    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }
  statement {
    sid = "ManageOwnRoles"
    actions = [
      "iam:GetRole", "iam:DeleteRole", "iam:TagRole", "iam:UntagRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
      "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
      "iam:DetachRolePolicy", "iam:ListInstanceProfilesForRole",
    ]
    resources = [local.role_arn_pattern]
  }
  statement {
    sid       = "PassOwnRoles"
    actions   = ["iam:PassRole"]
    resources = [local.role_arn_pattern]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }

  # Explicit denies win over any allow: the GitHub roles and the boundary itself are off limits
  statement {
    sid       = "ProtectGithubRoles"
    effect    = "Deny"
    actions   = ["iam:*"]
    resources = ["${local.github_role_arn_prefix}*"]
  }
  statement {
    sid       = "ProtectBoundary"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:SetDefaultPolicyVersion"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-monitoring-stack"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
