---
name: add-lab-task
description: "Scaffold a new lab or task (LabN/TaskM) with project, xUnit tests, solution folder and README. Use when starting Lab2 or a new task."
---
# Add a lab task

Target layout: `LabN/LabN.slnx`, `LabN/README.md`, `LabN/TaskM/{README.md, TaskM.<Name>/, TaskM.<Name>.Tests/}`.
Keep it **basic**: only what the assignment asks.

```bash
DN="/mnt/c/Program Files/dotnet/dotnet.exe"      # from PowerShell: dotnet
cd LabN
"$DN" new sln -n LabN                                            # once per lab (creates LabN.slnx)
"$DN" new console  -n TaskM.Name -o TaskM/TaskM.Name -f net10.0 --use-program-main   # or: winforms
"$DN" new xunit    -n TaskM.Name.Tests -o TaskM/TaskM.Name.Tests -f net10.0        # net10.0-windows for WinForms
"$DN" add TaskM/TaskM.Name.Tests reference TaskM/TaskM.Name
"$DN" sln LabN.slnx add TaskM/TaskM.Name TaskM/TaskM.Name.Tests --solution-folder TaskM
```

Then:
- `<InternalsVisibleTo Include="TaskM.Name.Tests" />` in the project; keep classes `internal`.
- Separate pure logic from I/O so it can be unit-tested (see `Lab1/Task1` for the pattern).
- Tests named as requirements (`ReplacesOnlyLinesContainingTheWord`).
- `TaskM/README.md` starts with **How to demo** (three lines), then what it does, usage, tests.
- Add the task to `LabN/README.md` and the root `README.md`; CI picks up `Lab*/Lab*.slnx` automatically.
- Finish with the `verify-before-push` skill.
