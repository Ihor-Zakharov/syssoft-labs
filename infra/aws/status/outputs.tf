output "table_name" {
  value = aws_dynamodb_table.checks.name
}

output "table_arn" {
  value = aws_dynamodb_table.checks.arn
}

output "function_name" {
  value = aws_lambda_function.prober.function_name
}

output "schedule_name" {
  value = aws_scheduler_schedule.every_minute.name
}

output "log_group" {
  value = aws_cloudwatch_log_group.prober.name
}
