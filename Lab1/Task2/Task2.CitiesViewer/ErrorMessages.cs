namespace Task2.CitiesViewer;

internal static class ErrorMessages
{
    private const int CannotOpenDatabase = 4060;
    private const int InvalidObjectName = 208;

    /// <summary>Turns the most likely SQL Server errors into a hint on how to fix them.</summary>
    public static string ForSqlError(int number, string message, string database) => number switch
    {
        CannotOpenDatabase =>
            $"The database {database} does not exist or cannot be opened.\n\n" +
            "Create the lab database in SSMS: run Lab1/Task2/sql/01-create-database.sql, then 02-schema-and-data.sql.",
        InvalidObjectName =>
            $"The table dbo.MyVisitedCities does not exist in {database}.\n\n" +
            "Run Lab1/Task2/sql/02-schema-and-data.sql against the database in SSMS.",
        _ => message,
    };
}
