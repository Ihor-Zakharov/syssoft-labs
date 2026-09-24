---
name: verify-before-push
description: "Run all checks for the changed areas and scan for secrets before committing or pushing. Use before every commit/PR."
---
# Verify before push

1. What changed: `git status --short` and `git diff --stat origin/main...`.
2. Run the checks for each touched area:

| Area | Checks |
|---|---|
| `Lab*/` | `dotnet build Lab1/Lab1.slnx -c Release -warnaserror` · `dotnet test Lab1/Lab1.slnx` · `dotnet format Lab1/Lab1.slnx --verify-no-changes` (Windows SDK) |
| `labwatch/` | `cd labwatch && pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build` |
| `infra/aws/` | `terraform fmt -check -recursive infra/aws` · `terraform -chdir=infra/aws/<stack> init -backend=false && terraform -chdir=infra/aws/<stack> validate` · `cd infra/aws/status/lambda && node --test` |
| `.github/workflows/` | `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` |

3. Secret scan — **only the staged diff**, never the secret files themselves:
   ```bash
   git diff --cached | grep -nE 'github_pat_|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|aws_secret_access_key|PRIVATE KEY|gho_' && echo "STOP: secret-like text staged"
   git diff --cached --name-only | grep -E '(^|/)\.env|\.tfvars$|\.tfstate|/\.terraform/' && echo "STOP: forbidden file staged"
   ```
4. Commit message: imperative summary; no attribution lines.
5. README / "How to demo" updated if behaviour changed.
