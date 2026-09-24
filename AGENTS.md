# AGENTS.md — rules for AI agents working in this repository

Read this before changing anything. It applies to every agent (Claude Code, the CI review, Antigravity, …).

## What this repository is

System-software labs in C# / .NET 10 plus the tooling around them:

| Path | What | Stack |
|---|---|---|
| `Lab1/` | four lab tasks, one solution `Lab1/Lab1.slnx`, each task in `Lab1/TaskN/` with its project, `*.Tests` project and README | .NET 10, console + WinForms, LocalDB, registry, MailKit |
| `labwatch/` | monitoring dashboard for this repo and the lab environment | pnpm workspace: NestJS (collector, gateway), tRPC, React/Vite, PostgreSQL, Redis, Docker Compose |
| `infra/aws/` | 24/7 site prober on AWS: `bootstrap` (OIDC roles, boundary, budget) and `status` (Lambda + Scheduler + DynamoDB) | Terraform, state in HCP Terraform (org `zakharov-syssoft`, execution mode Local) |
| `tools/` | `sysprog` launcher (if present) | PowerShell + bash |
| `.github/workflows/` | CI/CD, see below | GitHub Actions |

## Environment split — important

- **Lab1 builds on Windows.** WinForms, LocalDB and the registry are Windows-only. From WSL call the Windows SDK:
  `"/mnt/c/Program Files/dotnet/dotnet.exe"` with Windows paths. WSL has **no** `dotnet`.
- **labwatch and Terraform live in WSL** (`~/projects/syssoft-labs`, Node via nvm, Docker Engine in WSL).
- LocalDB instance: `(localdb)\MSSQLLocalDB`, lab database `ZAKHAROV-LAB1` (files in `C:\LAB-1\Task-6`).
- Mailpit for Task4 tests: `Lab1/Task4/compose.yaml`, SMTP `127.0.0.1:1025`, UI `:8025`.

## Build, test, run

```bash
# Lab1 (Windows SDK; from PowerShell drop the path and quotes)
"/mnt/c/Program Files/dotnet/dotnet.exe" build Lab1/Lab1.slnx -c Release -warnaserror
"/mnt/c/Program Files/dotnet/dotnet.exe" test Lab1/Lab1.slnx
"/mnt/c/Program Files/dotnet/dotnet.exe" format Lab1/Lab1.slnx --verify-no-changes
sysprog lab1 task1 flashrom              # if tools/sysprog is installed (see tools/README.md)

# labwatch (WSL)
cd labwatch && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build
docker compose up -d --build             # dashboard: http://localhost:8080 (needs labwatch/.env)

# infra (WSL)
terraform fmt -check -recursive infra/aws
AWS_PROFILE=syssoft terraform -chdir=infra/aws/status plan
(cd infra/aws/status/lambda && node --test)
```

## Conventions

- **English** in code, comments, commits, READMEs, UI.
- **Labs stay basic**: exactly what the assignment asks, quick to demo. No extra options. Every task has tests and a
  README that starts with **"How to demo"** (three lines).
- Comments explain **why**, not what the code does.
- Commit messages: imperative summary line, optional body with bullets. Author is the repository owner; **no
  `Co-Authored-By` or "Generated with" lines** in commits or PRs.
- Work on a branch → PR → checks green → merge. Never push to `main` directly.

### CI/CD (what runs when)

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push to main / PR, except `labwatch/**`, `infra/**`, `**/*.md` | Windows: build `-warnaserror`, test, `dotnet format` for every `Lab*/Lab*.slnx` |
| `labwatch.yml` | `labwatch/**` | pnpm typecheck/test/build (with Postgres), Docker images |
| `infra.yml` | `infra/aws/**` | fmt/validate/lambda tests; PR → `plan` (read-only OIDC role); main → `apply` of `status` (deploy role, main only) |
| `review.yml` | PR opened/ready/reopened or label `review` | agentic review (Claude) — takes effect only for the version on `main`; changing it in a PR makes it skip |
| `send-lab1-email.yml` | manual (`workflow_dispatch`), main only | Task4 real email via Gmail (`vars.LAB1_SMTP_USER`, `secrets.LAB1_SMTP_PASSWORD`) |

The review action loads this repository's `CLAUDE.md`/`.claude/settings.json` (project setting source), so these
rules also guide the CI review.

## Security rules — never break these

- **Never read, print, grep or diff** `.env`, `.env.*`, `*.tfvars`, `~/.aws/**`, `~/.terraform.d/**`, SSH keys or any
  token file. Check presence only (`grep -c '^NAME=.\+' labwatch/.env`). Before committing scan `git diff --cached`.
- Secrets live only in environment variables / `.env` (git-ignored) / GitHub secrets. Never in code, README, logs.
- **`terraform apply` / `destroy` are run by the human only.** Agents write code and run `plan`.
- AWS: **always-free services only, no public endpoints** (no Function URL, API Gateway, CloudFront, NAT, EC2).
  Every role the deploy role creates must carry the `syssoft-labs-workload-boundary`.
- GitHub OIDC uses **immutable subjects** `repo:Ihor-Zakharov@109134305/syssoft-labs@1385280233:…`; trust
  policies must use that form (`var.github_oidc_subject`).
- GitHub API: labwatch budgets requests (≤ 40/h without a token, 20 of the 60/IP left for humans).

## Definition of done

1. Builds with no warnings; all tests pass; `dotnet format` / `pnpm typecheck` / `terraform fmt` clean.
2. New behaviour has tests; the README (and "How to demo" for labs) is updated.
3. `git diff --cached` contains no secrets; no `.env`, state or `.terraform/` tracked.
4. PR description says what changed and how it was verified.
