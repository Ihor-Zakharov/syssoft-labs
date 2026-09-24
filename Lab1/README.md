# Lab1

Open [`Lab1.slnx`](Lab1.slnx) in Visual Studio. Each task has its own folder with the program, its tests and a README
with a short demo. All tests: `dotnet test Lab1.slnx`.

| Task | What it does | Tech |
|---|---|---|
| [Task1](Task1/) | downloads `manual.txt` and writes `Manual-LIGHT.txt` where lines with a word become `WORD FOUND!!!` | Console, `HttpClient`, certificate pinning |
| [Task2](Task2/) | database `ZAKHAROV-LAB1` in LocalDB, table `MyVisitedCities` shown in a `DataGridView` | SSMS, LocalDB, WinForms |
| [Task3](Task3/) | reads `P5` (`REG_MULTI_SZ`) from `HKLM\SOFTWARE\Zakharov`, creates `P6` with two lines | Registry, WinForms |
| [Task4](Task4/) | sends an email with the date, time, first and last name; recipient and subject are required | Console, SMTP (MailKit), Mailpit in Docker |

Run any task by name from any folder: `sysprog lab1 task1 flashrom` (see [tools/README.md](../tools/README.md)).
