---
name: run-lab-task
description: "Run or demo a Lab task (build, run with arguments, where output goes). Use when asked to run, try or show Lab1 TaskN."
---
# Run a lab task

Labs build with the **Windows** .NET SDK. From WSL use `"/mnt/c/Program Files/dotnet/dotnet.exe"`; from PowerShell
just `dotnet`.

1. Read `Lab1/TaskN/README.md` → section **How to demo** (exact commands and prerequisites).
2. If `tools/sysprog` exists: `sysprog lab1 taskN <args>` (builds only when sources changed, runs in the current
   folder, passes the exit code through). Otherwise:
   ```bash
   dotnet run --project Lab1/TaskN/<Project> -c Release -- <args>
   ```
3. Prerequisites per task:
   - Task1 — none; writes `manual.txt` + `Manual-LIGHT.txt` into the **current folder**.
   - Task2 — LocalDB database `ZAKHAROV-LAB1` (SSMS scripts `sql/01`, `sql/02`). WinForms window.
   - Task3 — `registry/create-p5.reg` imported once (UAC); writing P6 needs an elevated process. WinForms.
   - Task4 — Gmail app password via `send-gmail.ps1`, or Mailpit (`Lab1/Task4/compose.yaml`) for tests.
4. Exit codes: 0 ok, 1 runtime failure, 2 usage error.

WinForms windows appear on the user's desktop — launch them only when asked, and close them afterwards.
