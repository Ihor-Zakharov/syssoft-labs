---
name: defense-prep
description: "Prepare the lab defense: demo script per task and likely questions with short answers. Use when the user prepares to present a lab."
---
# Defense prep

For each task, from `LabN/TaskN/README.md`:
1. **Demo script** (≤ 2 min): the three "How to demo" steps + what to point at on screen.
2. **Say first**: deviations from the assignment and why (e.g. Task1 URL from the assignment is 404 → the server by
   IP with a pinned certificate).
3. **Likely questions** with one-line answers, e.g.:
   - Task1: why pinning instead of `return true`; why download bytes; whole word via `(?<!\w)…(?!\w)`; exit codes.
   - Task2: LocalDB vs SQL Server; `N'…'` literals; `.mdf`/`.ldf`; `await using`; why the UI does not freeze.
   - Task3: `REG_MULTI_SZ` layout; 64-bit registry view vs WOW6432Node; why writing HKLM needs elevation.
   - Task4: SMTP dialogue (EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO, DATA); app password; envelope vs headers.
4. **Fallback**: screenshots in `TaskN/docs/`; tests (`dotnet test`) if live demo fails; for CI/CD show a finished
   Actions run.
5. Be transparent about AI assistance: code reviewed by an AI in CI, the student explains every part.
