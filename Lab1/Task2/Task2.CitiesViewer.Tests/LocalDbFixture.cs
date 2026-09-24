using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace Task2.CitiesViewer.Tests;

/// <summary>
/// Creates a throw-away database in LocalDB, runs the SSMS script 02-schema-and-data.sql on it and drops it afterwards.
/// If LocalDB is not installed, <see cref="UnavailableReason"/> is set and the tests are skipped.
/// </summary>
public sealed partial class LocalDbFixture : IAsyncLifetime
{
    private const string Master =
        @"Server=(localdb)\MSSQLLocalDB;Database=master;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=60";

    private readonly string _databaseName = "Task2Tests_" + Guid.NewGuid().ToString("N");

    public string ConnectionString { get; private set; } = "";

    public string? UnavailableReason { get; private set; }

    public async Task InitializeAsync()
    {
        try
        {
            await ExecuteAsync(Master, $"CREATE DATABASE [{_databaseName}];");
        }
        catch (Exception ex)
        {
            // Any failure here means "no usable LocalDB" (not installed, broken instance, no SQL client support):
            // the database tests are skipped instead of failing the whole class
            UnavailableReason = $"LocalDB is not available: {ex.GetType().Name}: {ex.Message}";
            return;
        }

        ConnectionString = new SqlConnectionStringBuilder(Master) { InitialCatalog = _databaseName }.ConnectionString;
        await RunScriptAsync("02-schema-and-data.sql");
    }

    public async Task DisposeAsync()
    {
        if (UnavailableReason is not null)
        {
            return;
        }

        SqlConnection.ClearAllPools();
        await ExecuteAsync(Master,
            $"ALTER DATABASE [{_databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_databaseName}];");
    }

    public async Task RunScriptAsync(string fileName)
    {
        var script = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "sql", fileName));
        foreach (var batch in SplitBatches(script))
        {
            await ExecuteAsync(ConnectionString, batch);
        }
    }

    public Task ExecuteAsync(string sql) => ExecuteAsync(ConnectionString, sql);

    /// <summary>
    /// GO is not T-SQL but a batch separator understood by SSMS and sqlcmd, so the client has to split on it.
    /// </summary>
    public static IEnumerable<string> SplitBatches(string script) =>
        GoLine().Split(script).Where(batch => !string.IsNullOrWhiteSpace(batch));

    private static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex GoLine();
}
