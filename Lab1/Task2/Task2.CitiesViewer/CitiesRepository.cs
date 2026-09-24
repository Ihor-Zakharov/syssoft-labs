using Microsoft.Data.SqlClient;

namespace Task2.CitiesViewer;

internal sealed record City(int Id, string? Name);

internal sealed class CitiesRepository(string connectionString)
{
    public async Task<IReadOnlyList<City>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        await using var command = new SqlCommand("SELECT ID, Name FROM dbo.MyVisitedCities ORDER BY ID;", connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var cities = new List<City>();
        while (await reader.ReadAsync(cancellationToken))
        {
            cities.Add(new City(reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetString(1)));
        }

        return cities;
    }
}
