# AWS infrastructure

A 24/7 prober for the university sites that labwatch shows on its **Status** tab. labwatch probes them from the
home PC while it is on; this stack keeps probing from Frankfurt when the PC is off, so the history has no gaps
and labwatch can compare two vantage points (`home` and `aws-eu-central-1`).

Everything is Terraform. State lives in **HCP Terraform** (organization `zakharov-syssoft`, execution mode
*Local*: HCP only stores state and the lock, it never gets AWS credentials).

## Architecture

```
                         every minute
EventBridge Scheduler ───────────────► Lambda syssoft-labs-status-prober (Node.js 24, arm64, 128 MB)
  syssoft-labs-status-every-minute         │  probes 4 sites in parallel (10 s timeout, no redirects,
                                           │  TLS recorded but not enforced), classifies each check
                                           ▼
                            DynamoDB syssoft-labs-status-checks (provisioned 3 RCU / 2 WCU)
                              check#<target> / <ISO time>   raw check        TTL 120 days
                              hour#<target>  / <UTC hour>   ADD counters     TTL 120 days
                              day#<target>   / <Kyiv date>  ADD counters     TTL ~400 days
                                           ▲
                                           │ Query (read-only IAM user, key in labwatch/.env)
                               labwatch collector on the home PC
```

Classification is the same as labwatch's: **down** = timeout, connection error, 5xx or unexpected 4xx;
**degraded** = answered but slower than 2 s; TLS problems (e.g. the expired certificate of 91.202.128.107) are
recorded as `tlsOk` / `tlsError` but are **not** an outage. Targets live in [`status/targets.json`](status/targets.json)
with the same ids as labwatch.

Two stacks:

| Stack | What | Applied by |
|---|---|---|
| [`bootstrap/`](bootstrap/) | GitHub OIDC provider; `syssoft-labs-gha-plan` (read-only, PRs) and `syssoft-labs-gha-deploy` (main only, `syssoft-labs-*` resources only) roles; permissions boundary for every role the deploy role creates; the zero-spend budget; the labwatch read-only user | **by hand**, from the PC (it defines CI's own permissions) |
| [`status/`](status/) | DynamoDB table, Lambda, log group, IAM roles, schedule | CI on push to `main`, or by hand |

## Why there is no public endpoint

A Lambda Function URL, API Gateway or a public bucket could be called by anyone, as often as they like. Every
call counts against the free tier and, after it, costs money. With no public entry point the only thing that
invokes the Lambda is the schedule — 1,440 calls a day, a number nobody else can change. labwatch reads the table
with a read-only key instead.

## Cost: always-free limits vs our usage

| Service | Always free per month | This stack |
|---|---|---|
| Lambda requests | 1,000,000 | ~43,200 (one per minute) |
| Lambda compute | 400,000 GB-s | ~43,200 × ~1 s × 0.125 GB ≈ 5,400 GB-s |
| EventBridge Scheduler | 14,000,000 invocations | ~43,200 |
| DynamoDB | 25 GB, 25 WCU, 25 RCU (provisioned) | 2 WCU, 3 RCU; ~0.2 writes/s average; tens of MB |
| CloudWatch Logs | 5 GB ingestion, 5 GB storage | ~1 KB per run ≈ 45 MB/month, kept 3 days |
| IAM, Budgets (no actions, no reports) | free | — |

Deliberately **not** used because they are not free: DynamoDB on-demand mode, point-in-time recovery, reserved
concurrency (also impossible: new accounts have a limit of 10 that must stay unreserved), NAT gateways, public
endpoints. The zero-spend budget emails as soon as anything costs more than $0.01.

## Plan and apply locally

```bash
aws sso login --profile syssoft --use-device-code
export AWS_PROFILE=syssoft

cd infra/aws/status
terraform init
terraform plan -out=status.tfplan     # read-only
terraform apply status.tfplan         # only after the plan was reviewed

# bootstrap: same, in infra/aws/bootstrap (needs terraform.tfvars with budget_email, not committed)
```

Test the prober logic without AWS:

```bash
cd infra/aws/status/lambda
node --test 'test/**/*.test.mjs'   # unit tests with local HTTP/HTTPS servers
node tools/dry-run.mjs             # probes the real sites from this machine, writes nothing
```

## CI/CD ([`.github/workflows/infra.yml`](../../.github/workflows/infra.yml))

- **Pull request** touching `infra/aws/**`: `terraform fmt -check`, `validate` of both stacks, Lambda tests, then
  `terraform plan` of `status` with the read-only role; the plan goes into the job summary.
- **Push to `main`**: the same checks, then `terraform apply` of `status` with the deploy role.
- AWS access is **OIDC only**: GitHub issues a short-lived token, AWS checks repository and branch and returns
  temporary credentials. There are no AWS keys in GitHub.

Needed once in the repository settings (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_PLAN_ROLE_ARN` | `terraform -chdir=infra/aws/bootstrap output -raw github_plan_role_arn` |
| Variable | `AWS_DEPLOY_ROLE_ARN` | `terraform -chdir=infra/aws/bootstrap output -raw github_deploy_role_arn` |
| Secret | `TF_API_TOKEN` | an HCP Terraform team or user token |

## labwatch read-only key

The bootstrap stack creates the IAM user `syssoft-labs-labwatch-reader` (DynamoDB `Query` / `GetItem` /
`DescribeTable` on `syssoft-labs-status-*` only, no console access) but **not** its access key — a key made by
Terraform would be stored in the state. Create it once:

1. AWS console → IAM → Users → `syssoft-labs-labwatch-reader` → Security credentials → Create access key →
   *Application running outside AWS*.
2. Put it only into `labwatch/.env` (git-ignored):
   `AWS_STATUS_ACCESS_KEY_ID=…`, `AWS_STATUS_SECRET_ACCESS_KEY=…`, `AWS_STATUS_REGION=eu-central-1`,
   `AWS_STATUS_TABLE=syssoft-labs-status-checks`.
3. Rotate it by creating a second key, switching `.env`, then deleting the old one.
