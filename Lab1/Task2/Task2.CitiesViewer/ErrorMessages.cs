namespace Task2.CitiesViewer;

internal static class ErrorMessages
{
    /// <summary>A hint for the two errors that mean "the lab database is not set up yet".</summary>
    public static string ForSqlError(int number, string message) => number switch
    {
        4060 => $"The database {ConnectionSettings.Database} does not exist. Create it in SSMS with sql/01-create-database.sql and sql/02-schema-and-data.sql.",
        208 => "The table dbo.MyVisitedCities does not exist. Run sql/02-schema-and-data.sql in SSMS.",
        _ => message,
    };
}
