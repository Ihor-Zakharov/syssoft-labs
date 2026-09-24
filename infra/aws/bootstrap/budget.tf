# Zero-spend alert: an email as soon as the account is charged more than $0.01 in a month.
# Monitoring only — no budget actions, nothing is stopped automatically.
#
# This is the "My Zero-Spend Budget" created from the console template (see the import block below);
# renaming it would replace it, so the template's name is kept.
resource "aws_budgets_budget" "zero_spend" {
  name         = "My Zero-Spend Budget"
  budget_type  = "COST"
  limit_amount = "1.0"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # The console template uses the account's primary billing view; keep it instead of clearing it
  billing_view_arn = "arn:${data.aws_partition.current.partition}:billing::${data.aws_caller_identity.current.account_id}:billingview/primary"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 0.01
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}

# Take over the budget created from the console template instead of creating a second one
import {
  to = aws_budgets_budget.zero_spend
  id = "${data.aws_caller_identity.current.account_id}:My Zero-Spend Budget"
}
