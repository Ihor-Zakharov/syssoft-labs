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
    public async Task ReadsNullNameAsNull()
    {
        Skip.If(db.UnavailableReason is not null, db.UnavailableReason);

        await db.ExecuteAsync("INSERT INTO dbo.MyVisitedCities (ID, Name) VALUES (100, NULL);");
        try
        {
            var cities = await new CitiesRepository(db.ConnectionString).GetAllAsync(CancellationToken.None);

            Assert.Equal(new City(100, null), cities[^1]);
        }
        finally
        {
            await db.ExecuteAsync("DELETE FROM dbo.MyVisitedCities WHERE ID = 100;");
        }
    }

    [SkippableFact]
    public async Task MissingDatabaseFailsFastWithError4060()
    {
        Skip.If(db.UnavailableReason is not null, db.UnavailableReason);

        var connectionString = ConnectionSettings.Default.Replace("ZAKHAROV-LAB1", "Task2Tests_Missing_" + Guid.NewGuid().ToString("N"));
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        var error = await Assert.ThrowsAsync<Microsoft.Data.SqlClient.SqlException>(
            () => new CitiesRepository(connectionString).GetAllAsync(CancellationToken.None));

        Assert.Equal(4060, error.Number);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(8), $"took {stopwatch.Elapsed} — the 10 s retry is back?");
    }

    [Fact]
    public void SplitsScriptOnGoLinesOnly()
    {
        var batches = LocalDbFixture.SplitBatches("SELECT 'GO';\r\nGO\r\n  go  \nSELECT 2;\nGO").ToList();

        Assert.Equal(["SELECT 'GO';\r\n", "\nSELECT 2;\n"], batches);
    }
}
