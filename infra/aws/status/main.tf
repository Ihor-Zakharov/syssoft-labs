# 24/7 site prober: EventBridge Scheduler (every minute) -> Lambda -> DynamoDB.
# Only always-free services and no public endpoint: nothing here can be called from the internet.

locals {
  account_id    = data.aws_caller_identity.current.account_id
  partition     = data.aws_partition.current.partition
  function_name = "${var.project}-status-prober"
  targets       = jsondecode(file("${path.module}/targets.json"))

  # Created by the bootstrap stack; every role of this stack must carry it (the deploy role enforces that).
  # Built from the name instead of a data source, so the deploy role needs no extra IAM read permissions.
  workload_boundary_arn = "arn:${local.partition}:iam::${local.account_id}:policy/${var.project}-workload-boundary"
}

# ---------------------------------------------------------------------------------------------------------------
# Storage: raw checks + hourly/daily rollups in one table (single-table design)
#   pk "check#<target>" / sk ISO time    raw check, kept 120 days
#   pk "hour#<target>"  / sk hour (UTC)  counters, kept 120 days
#   pk "day#<target>"   / sk Kyiv date   counters, kept ~400 days
# Provisioned capacity: the always-free tier covers 25 RCU + 25 WCU per account (on-demand is NOT free).
# Average load is ~0.2 writes/s (4 puts + 8 counter updates per minute); bursts are absorbed by burst capacity.

resource "aws_dynamodb_table" "checks" {
  name           = "${var.project}-status-checks"
  billing_mode   = "PROVISIONED"
  read_capacity  = 3
  write_capacity = 2
  hash_key       = "pk"
  range_key      = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Expired items are deleted by DynamoDB for free (no write capacity used)
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # Continuous backups are billed per GB-month: off
  point_in_time_recovery {
    enabled = false
  }
}

# ---------------------------------------------------------------------------------------------------------------
# Lambda

data "archive_file" "prober" {
  type        = "zip"
  source_dir  = "${path.module}/lambda/src"
  output_path = "${path.module}/.build/prober.zip"
}

# Created before the function, so Lambda never auto-creates a log group that keeps logs forever
resource "aws_cloudwatch_log_group" "prober" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "prober" {
  name                 = local.function_name
  assume_role_policy   = data.aws_iam_policy_document.lambda_trust.json
  permissions_boundary = local.workload_boundary_arn
}

data "aws_iam_policy_document" "prober" {
  statement {
    sid       = "WriteChecks"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.checks.arn]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.prober.arn}:*"]
  }
}

resource "aws_iam_role_policy" "prober" {
  name   = "write-status-checks"
  role   = aws_iam_role.prober.id
  policy = data.aws_iam_policy_document.prober.json
}

resource "aws_lambda_function" "prober" {
  function_name    = local.function_name
  description      = "Probes the monitored sites every minute and stores the results in DynamoDB"
  role             = aws_iam_role.prober.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.prober.output_path
  source_code_hash = data.archive_file.prober.output_base64sha256
  memory_size      = 128
  timeout          = 30

  # No reserved concurrency: new accounts have a total limit of 10 and AWS requires all 10 to stay unreserved.
  # The function has no public trigger, so only the schedule below (one call per minute) can run it.

  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.checks.name
      VANTAGE      = var.vantage
      TARGETS_JSON = jsonencode(local.targets)
      DEGRADED_MS  = tostring(var.degraded_ms)
    }
  }

  depends_on = [aws_cloudwatch_log_group.prober, aws_iam_role_policy.prober]
}

# The scheduler invokes asynchronously; Lambda would retry a failed run twice by default and the rollup counters
# would count those checks again. A missed minute is better than a double-counted one.
resource "aws_lambda_function_event_invoke_config" "prober" {
  function_name                = aws_lambda_function.prober.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 60
}

# ---------------------------------------------------------------------------------------------------------------
# Schedule: every minute

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    # Only schedules of this account may use the role (confused-deputy protection)
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name                 = "${var.project}-status-scheduler"
  assume_role_policy   = data.aws_iam_policy_document.scheduler_trust.json
  permissions_boundary = local.workload_boundary_arn
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.prober.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-prober"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "every_minute" {
  name                = "${var.project}-status-every-minute"
  description         = "Runs the site prober once a minute"
  schedule_expression = "rate(1 minute)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.prober.arn
    role_arn = aws_iam_role.scheduler.arn

    # The next run is a minute away anyway: don't pile up retries
    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 60
    }
  }
}
