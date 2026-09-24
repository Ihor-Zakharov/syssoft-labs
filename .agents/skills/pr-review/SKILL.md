---
name: pr-review
description: "Review a pull request or local diff with the same focus as the CI review. Use when asked to review changes."
---
# PR review

```bash
gh pr view <n> && gh pr diff <n>          # or: git diff origin/main...
gh pr checks <n>
```

Check, in order (report only real issues, with file:line):
1. **Correctness** against the assignment / intent; edge cases (empty input, missing files/DB/registry keys).
2. **Resources**: `using`/`await using` for IDisposable, HttpClient lifetime, process pipes drained, registry
   handles closed.
3. **Security**: TLS/certificate validation (pinning, never "accept all"), SQL parameters (no concatenation),
   secrets in code/logs, container/network exposure (ports bound to 127.0.0.1), IAM least privilege.
4. **Errors**: meaningful messages and exit codes, no raw stack traces for expected failures.
5. **Tests**: new behaviour covered; tests do not depend on the network or wall-clock timing.
6. Labs stay **basic**; README "How to demo" still accurate.
Skip style nitpicks that `dotnet format` / TypeScript / terraform fmt enforce.
