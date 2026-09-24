# Task3 — Windows registry: show P5, create P6

Key `HKLM\SOFTWARE\Zakharov` with the value `P5` of type **MultiString** (`REG_MULTI_SZ`) and a Windows Forms program
with two buttons:

- **Show P5** — shows every line of `P5`;
- **Create P6** — creates `P6` (`REG_MULTI_SZ`) with two lines and shows what was stored.

## Demo

1. Double-click [`registry/create-p5.reg`](registry/create-p5.reg) and confirm (UAC) — creates the key and `P5` with three
   lines (`Ihor Zakharov`, `Лабораторна робота 1`, `System software`).
2. Start `Task3.RegistryViewer` **as administrator** (writing to HKLM needs it; Visual Studio: run VS as administrator)
   → **Show P5**, then **Create P6**. Check in `regedit` → `HKEY_LOCAL_MACHINE\SOFTWARE\Zakharov`.
3. [`registry/delete-zakharov.reg`](registry/delete-zakharov.reg) removes the key again.

Without administrator rights **Show P5** still works and **Create P6** says to run the program as administrator.

## Code

- `LabRegistry` — reads with a read-only key and one `GetValue` (the returned `string[]` means `REG_MULTI_SZ`), writes
  with `SetValue(..., RegistryValueKind.MultiString)`.
- The key is opened with `RegistryView.Registry64`, so a 32-bit build is not redirected to `WOW6432Node`.
- `create-p5.reg` stores `P5` as `hex(7)` — the raw UTF-16 bytes — so the Cyrillic line does not depend on the file
  encoding.

## Tests

`dotnet test ../Lab1.slnx` — on a temporary key under HKCU (no administrator rights needed): reading all lines,
creating and overwriting `P6`, reporting a missing key or value, and importing the real `create-p5.reg` with `reg.exe`
(all three lines, Cyrillic byte-exact).
