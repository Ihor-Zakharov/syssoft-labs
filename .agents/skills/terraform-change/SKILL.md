---
name: terraform-change
description: "Change AWS infrastructure safely with Terraform (plan only; apply is done by the human). Use for anything under infra/aws/."
---
# Terraform change

Stacks: `infra/aws/bootstrap` (OIDC roles, boundary, budget; applied by hand) and `infra/aws/status` (Lambda +
Scheduler + DynamoDB; planned on PRs, applied from `main` by CI). State: HCP Terraform, org `zakharov-syssoft`,
workspaces `syssoft-labs-aws-bootstrap` / `syssoft-labs-aws-status`, execution mode **Local**.

```bash
export AWS_PROFILE=syssoft                      # SSO; if expired the HUMAN runs: aws sso login --profile syssoft --use-device-code
terraform -chdir=infra/aws/status init
terraform -chdir=infra/aws/status plan -out=status.tfplan
terraform -chdir=infra/aws/status show -no-color status.tfplan | grep -E 'will be|Plan:'
```

Then **stop**: summarise the plan (resources, cost impact) and let the human run `terraform apply status.tfplan`.
Agents never run `apply` or `destroy`.

Checklist:
- Always-free only; no public endpoints (Function URL, API Gateway, CloudFront, NAT, EC2, S3 website).
- DynamoDB **PROVISIONED** (on-demand is not free), log groups with short retention.
- New IAM roles: name `syssoft-labs-*` and `permissions_boundary = syssoft-labs-workload-boundary`; least privilege.
- Deploy-role permissions (`bootstrap/github.tf`) must cover every API the stack needs — changes there need a
  bootstrap plan + human apply first.
- OIDC trust uses the immutable subject (`var.github_oidc_subject`).
- `terraform fmt -check -recursive infra/aws` and `validate` before committing.
