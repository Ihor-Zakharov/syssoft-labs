# Task2 — LocalDB database shown in a DataGridView

Database `ZAKHAROV-LAB1` in SQL Server LocalDB with its files in `C:\LAB-1\Task-6`, table `MyVisitedCities`
(`ID int`, `Name nvarchar(max)`) with three rows — two of them in Cyrillic — and a Windows Forms program that shows the
table in a `DataGridView`.

![Task2 window](docs/task2-window.png)

## Demo

1. SSMS → connect to `(localdb)\MSSQLLocalDB` (Windows Authentication, *Trust server certificate*).
2. Run [`sql/01-create-database.sql`](sql/01-create-database.sql) — creates `C:\LAB-1\Task-6` and the database files.
3. Right-click **ZAKHAROV-LAB1 → New Query**, run [`sql/02-schema-and-data.sql`](sql/02-schema-and-data.sql) — the table
   and the rows (`N'...'` literals keep the Cyrillic names).
4. Start `Task2.CitiesViewer` (F5 in Visual Studio): the grid shows `1 Київ`, `2 Львів`, `3 Warsaw`; **Refresh** reloads.

If the database or the table is missing, the program says which script to run. Both scripts can be run again.

## Code

- `CitiesRepository` — `SELECT ID, Name FROM dbo.MyVisitedCities ORDER BY ID` with `Microsoft.Data.SqlClient`.
- `MainForm` — binds the rows to the `DataGridView` through a `BindingSource`.
- `ConnectionSettings` — the connection string: `TrustServerCertificate` (LocalDB's certificate is self-signed),
  `Connect Timeout=30` (the first connection may start LocalDB), `ConnectRetryCount=0` (no 10 s retry on a missing
  database).

## Tests

`dotnet test ../Lab1.slnx` — on a temporary LocalDB database the same `02` script creates the table with the three
rows (Cyrillic intact) and can run twice; a missing database fails at once with error 4060. Without LocalDB the tests
are skipped.
