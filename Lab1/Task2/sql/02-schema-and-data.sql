-- Lab 1, Task 2 — step 2 of 2: table MyVisitedCities with three rows, two of them in Cyrillic.
-- Run against ZAKHAROV-LAB1 (in SSMS: right-click the database -> New Query). Safe to run again.
-- The script has no USE statement on purpose: tests run it against a temporary database.

IF OBJECT_ID(N'dbo.MyVisitedCities', N'U') IS NULL
    CREATE TABLE dbo.MyVisitedCities
    (
        ID   int           NOT NULL CONSTRAINT PK_MyVisitedCities PRIMARY KEY,
        Name nvarchar(max) NULL
    );
GO

-- N'...' makes a literal Unicode; without the N, Cyrillic turns into '?' under a non-Cyrillic collation
MERGE dbo.MyVisitedCities AS target
USING (VALUES
          (1, N'Київ'),
          (2, N'Львів'),
          (3, N'Warsaw')
      ) AS source (ID, Name)
    ON target.ID = source.ID
WHEN MATCHED THEN
    UPDATE SET Name = source.Name
WHEN NOT MATCHED THEN
    INSERT (ID, Name) VALUES (source.ID, source.Name);
GO
