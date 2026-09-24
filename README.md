# syssoft-labs

Test1 - message from the branch 

System software labs (C# / .NET 10) plus the tooling around them: a monitoring dashboard (labwatch), a 24/7 site
prober on AWS managed with Terraform, and CI/CD with an agentic code review.

## Lab1 — [`Lab1/`](Lab1/README.md)

Open `Lab1/Lab1.slnx` in Visual Studio; each task folder has a README that starts with "How to demo".
All tests: `dotnet test Lab1/Lab1.slnx`.

| Task | What it does |
|---|---|
| [Task1](Lab1/Task1/) | downloads `manual.txt` into the current folder and writes `Manual-LIGHT.txt`, where every line with the given word becomes `WORD FOUND!!!` |
| [Task2](Lab1/Task2/) | LocalDB database `ZAKHAROV-LAB1` (created in SSMS) with the table `MyVisitedCities`, shown in a `DataGridView` |
| [Task3](Lab1/Task3/) | Windows Forms: shows the `REG_MULTI_SZ` value `P5` from `HKLM\SOFTWARE\Zakharov`, creates `P6` with two lines |
| [Task4](Lab1/Task4/) | sends an email with the date, time, first and last name; the recipient and the subject are required |

## labwatch — [`labwatch/`](labwatch/README.md)

Monitoring dashboard for this repository and the lab's environment (NestJS microservices, tRPC, React, PostgreSQL,
Redis, Docker): CI runs with jobs and review findings, commits by lab area, pull requests, service health,
integrations (GitHub, AWS, HCP Terraform) and a status page for the university sites seen from home and from AWS.

```bash
cd labwatch && docker compose up -d --build     # then open http://localhost:8080
```

State of the work and how to continue: [`labwatch/docs/HANDOFF.md`](labwatch/docs/HANDOFF.md).

## AWS — [`infra/aws/`](infra/aws/README.md)

A Lambda in eu-central-1 checks the university sites every minute and writes the results to DynamoDB; labwatch reads
them with a read-only key. Everything is Terraform, state lives in HCP Terraform, and only always-free services are
used (no public endpoints). The `bootstrap` stack (GitHub OIDC roles, permissions boundary, zero-spend budget) is
applied by hand; the `status` stack is planned on pull requests and applied from `main` by CI.

## CI/CD — [`.github/workflows/`](.github/workflows/)

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | push to `main`, pull requests (not for `labwatch/`, `infra/` or Markdown-only changes) | builds every `Lab*/Lab*.slnx` on Windows with warnings as errors, runs the tests, checks formatting |
| `review.yml` | pull request opened / ready for review / label `review` | agentic code review: inline comments and a summary on the PR |
| `labwatch.yml` | changes in `labwatch/` | typecheck, tests (with PostgreSQL), build, Docker images |
| `infra.yml` | changes in `infra/aws/` | fmt, validate, Lambda tests, `terraform plan` on pull requests; `terraform apply` of the status stack on `main` |

## Before pushing

Repository settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| variable | `AWS_PLAN_ROLE_ARN` | `arn:aws:iam::816600798305:role/syssoft-labs-gha-plan` (a bootstrap output, not a secret) |
| variable | `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::816600798305:role/syssoft-labs-gha-deploy` |
| secret | `TF_API_TOKEN` | HCP Terraform token (organization `zakharov-syssoft`) |
| secret | `CLAUDE_CODE_OAUTH_TOKEN` | already set — used by `review.yml` |
| variable | `LAB1_SMTP_USER` | Gmail address that sends the Lab1 email (`send-lab1-email.yml`) |
| secret | `LAB1_SMTP_PASSWORD` | Gmail app password for it |

The review action only runs when `review.yml` in a pull request is identical to the one on `main`, so changes to
`review.yml` take effect after they reach `main`.
