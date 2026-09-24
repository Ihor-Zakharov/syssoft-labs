using Microsoft.Data.SqlClient;

namespace Task2.CitiesViewer;

internal static class ConnectionSettings
{
    public const string EnvironmentVariable = "LAB1_TASK2_CONNECTION";

    // LocalDB uses a self-signed certificate, so it has to be trusted explicitly (the client encrypts by default).
    // The first connection may start the LocalDB instance, which can take longer than the default 15 s.
    // ConnectRetryCount=0: SqlClient treats error 4060 (no such database) as transient and waits 10 s before retrying,
    // which only makes sense for Azure SQL failovers, not for a local database.
    public const string Default =
        @"Server=(localdb)\MSSQLLocalDB;Database=ZAKHAROV-LAB1;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=30;ConnectRetryCount=0";

    /// <summary>Command-line argument first, then the environment variable, then <see cref="Default"/>.</summary>
    public static string Resolve(string[] args, string? fromEnvironment)
    {
        if (args.Length > 0 && !string.IsNullOrWhiteSpace(args[0]))
        {
            return args[0];
        }

        return string.IsNullOrWhiteSpace(fromEnvironment) ? Default : fromEnvironment;
    }

    public static string DatabaseName(string connectionString) =>
        new SqlConnectionStringBuilder(connectionString).InitialCatalog;

    /// <summary>"server / database" for the status bar — never shows credentials.</summary>
    public static string Describe(string connectionString)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        return $"{builder.DataSource} / {builder.InitialCatalog}";
    }
}
