output "account_id" {
  value = local.account_id
}

output "region" {
  value = var.region
}

output "github_plan_role_arn" {
  description = "Set as repository variable AWS_PLAN_ROLE_ARN"
  value       = aws_iam_role.plan.arn
}

output "github_deploy_role_arn" {
  description = "Set as repository variable AWS_DEPLOY_ROLE_ARN"
  value       = aws_iam_role.deploy.arn
}

output "workload_boundary_arn" {
  description = "Permissions boundary every role of the monitoring stack must carry"
  value       = aws_iam_policy.boundary.arn
}

output "labwatch_reader_user" {
  description = "IAM user whose access key labwatch uses to read the status table (key created in the console)"
  value       = aws_iam_user.labwatch_reader.name
}
