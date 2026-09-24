# sysprog — run the lab tasks by name

```
sysprog lab1 task1 flashrom        # build if needed, run Task1 in the current folder with "flashrom"
sysprog lab1 task4 teacher@knu.ua LAB-1
sysprog list                       # every lab and task, discovered from the repository
sysprog test lab1 task2            # tests of one task (or: sysprog test lab1, sysprog test)
sysprog build lab1 | open lab1 | readme lab1 task3 | help
```

Two implementations with the same commands: `tools/sysprog.ps1` (Windows PowerShell 5.1 / PowerShell 7) and
`tools/sysprog` (bash on Ubuntu / WSL).

## Install

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\Ihor\projects\syssoft-labs\tools\sysprog.ps1 install
```

Ubuntu / WSL:

```bash
~/projects/syssoft-labs/tools/sysprog install      # or the /mnt/c/... path of the Windows clone
```

`install` adds a marked block to `$PROFILE` / `~/.bashrc` with the `sysprog` command and **Tab completion** for
commands, labs and tasks; running it again replaces the block, `uninstall` removes it. Open a new terminal afterwards.

## How it works

- **Discovery, nothing hard-coded**: labs are the `Lab<N>` folders at the repository root, tasks the `Task<M>` folders
  inside, the runnable project is the `*.csproj` in the task folder that is not `*.Tests`. A new `Lab2/Task1` shows up
  in `sysprog list` and completion without touching the script.
- **Names**: case-insensitive, numbers alone work — `lab1`, `Lab1`, `1`; `task3`, `3`.
- **Fast start**: the project is built (`dotnet build -c Release`, quiet) only when a `.cs`, `.csproj` or `.resx`
  file is newer than the executable; then the `.exe` itself is started with your arguments passed through unchanged
  (quoted arguments with spaces stay one argument) and its exit code is returned.
- **Current folder**: the task runs where you are — `cd` to a folder (or open it in Far) and Task1 writes its two
  files there.
- **WSL**: the tasks target Windows (WinForms, registry, LocalDB), so the bash version uses the Windows SDK
  (`C:\Program Files\dotnet\dotnet.exe`) with `wslpath -w` paths and starts the Windows `.exe` through WSL interop.
- Task3 writes to `HKLM`: run it from an administrator terminal (a hint is printed otherwise).
