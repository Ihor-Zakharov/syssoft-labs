# Read-only identity for labwatch (runs on the home PC, outside AWS and GitHub, so it cannot use OIDC).
# No console access and no access key from Terraform: a key created here would be stored in the state.
# The key is created once in the console (IAM -> Users -> syssoft-labs-labwatch-reader -> Security credentials)
# and goes only into labwatch/.env, which is never committed.

resource "aws_iam_user" "labwatch_reader" {
  name = "${local.prefix}-labwatch-reader"
}

data "aws_iam_policy_document" "labwatch_reader" {
  statement {
    sid     = "ReadStatusChecks"
    actions = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:DescribeTable"]
    resources = [
      "arn:${local.partition}:dynamodb:${var.region}:${local.account_id}:table/${local.prefix}-status-*",
    ]
  }
}

resource "aws_iam_user_policy" "labwatch_reader" {
  name   = "read-status-checks"
  user   = aws_iam_user.labwatch_reader.name
  policy = data.aws_iam_policy_document.labwatch_reader.json
}
