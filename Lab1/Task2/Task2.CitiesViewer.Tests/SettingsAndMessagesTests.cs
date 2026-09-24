namespace Task2.CitiesViewer.Tests;

public class SettingsAndMessagesTests
{
    [Fact]
    public void ArgumentWinsOverEnvironmentAndDefault()
    {
        Assert.Equal("from-arg", ConnectionSettings.Resolve(["from-arg"], "from-env"));
    }

    [Fact]
    public void EnvironmentWinsOverDefault()
    {
        Assert.Equal("from-env", ConnectionSettings.Resolve([], "from-env"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public void FallsBackToLocalDb(string? fromEnvironment)
    {
        Assert.Equal(ConnectionSettings.Default, ConnectionSettings.Resolve([""], fromEnvironment));
    }

    [Fact]
    public void DefaultPointsToLabDatabase()
    {
        Assert.Equal(@"(localdb)\MSSQLLocalDB / ZAKHAROV-LAB1", ConnectionSettings.Describe(ConnectionSettings.Default));
    }

    [Fact]
    public void DescriptionNeverContainsCredentials()
    {
        var description = ConnectionSettings.Describe("Server=db.example;Database=cities;User ID=lab;Password=s3cret");

        Assert.Equal("db.example / cities", description);
    }

    [Fact]
    public void DatabaseNameComesFromConnectionString()
    {
        Assert.Equal("NO_SUCH_DB", ConnectionSettings.DatabaseName(@"Server=(localdb)\MSSQLLocalDB;Database=NO_SUCH_DB"));
    }

    [Fact]
    public void DefaultDoesNotRetryMissingDatabase()
    {
        Assert.Contains("ConnectRetryCount=0", ConnectionSettings.Default);
    }

    [Theory]
    [InlineData(4060, "01-create-database.sql")]
    [InlineData(208, "02-schema-and-data.sql")]
    public void KnownErrorsNameTheDatabaseAndExplainHowToFix(int number, string script)
    {
        var message = ErrorMessages.ForSqlError(number, "raw", "NO_SUCH_DB");

        Assert.Contains("NO_SUCH_DB", message);
        Assert.Contains(script, message);
    }

    [Fact]
    public void UnknownErrorKeepsOriginalMessage()
    {
        Assert.Equal("raw", ErrorMessages.ForSqlError(18456, "raw", "db"));
    }
}
