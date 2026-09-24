namespace Task2.CitiesViewer.Tests;

public sealed class CitiesRepositoryTests(LocalDbFixture db) : IClassFixture<LocalDbFixture>
{
    [SkippableFact]
    public async Task ReadsSeededCitiesWithCyrillicNamesIntact()
    {
        Skip.If(db.UnavailableReason is not null, db.UnavailableReason);

        var cities = await new CitiesRepository(db.ConnectionString).GetAllAsync(CancellationToken.None);

        City[] expected = [new(1, "Київ"), new(2, "Львів"), new(3, "Warsaw")];
        Assert.Equal(expected, cities);
    }

    [SkippableFact]
    public async Task SchemaScriptCanRunTwice()
    {
        Skip.If(db.UnavailableReason is not null, db.UnavailableReason);

        await db.RunScriptAsync("02-schema-and-data.sql");
        var cities = await new CitiesRepository(db.ConnectionString).GetAllAsync(CancellationToken.None);

        Assert.Equal(3, cities.Count);
    }

    [SkippableFact]
    public async Task MissingDatabaseFailsFastWithError4060()
    {
        Skip.If(db.UnavailableReason is not null, db.UnavailableReason);

        // Keep the app's ConnectRetryCount but stretch the retry interval to 30 s: if the retry ever comes back,
        // the call takes 30+ s, far above the 20 s limit below, while a slow runner still has plenty of headroom
        var connectionString = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(ConnectionSettings.ConnectionString)
        {
            InitialCatalog = "Task2Tests_Missing_" + Guid.NewGuid().ToString("N"),
            ConnectRetryInterval = 30,
        }.ConnectionString;
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        var error = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(
            () => new CitiesRepository(connectionString).GetAllAsync(CancellationToken.None));

        Assert.Equal(4060, error.Number);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(20), $"took {stopwatch.Elapsed} — the connection retry is back?");
    }
}
