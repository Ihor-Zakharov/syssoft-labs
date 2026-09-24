-- Lab 1, Task 2 — step 1 of 2: database ZAKHAROV-LAB1 with its files in C:\LAB-1\Task-6.
-- Run in SSMS connected to (localdb)\MSSQLLocalDB, then run 02-schema-and-data.sql.
-- Safe to run again: an existing database is left as it is.

USE master;
GO

-- SQL Server does not create missing folders for database files
EXEC master.sys.xp_create_subdir N'C:\LAB-1\Task-6';
GO

IF DB_ID(N'ZAKHAROV-LAB1') IS NULL
    CREATE DATABASE [ZAKHAROV-LAB1]
        ON PRIMARY (NAME = N'ZAKHAROV-LAB1',     FILENAME = N'C:\LAB-1\Task-6\ZAKHAROV-LAB1.mdf')
        LOG ON     (NAME = N'ZAKHAROV-LAB1_log', FILENAME = N'C:\LAB-1\Task-6\ZAKHAROV-LAB1_log.ldf');
GO
