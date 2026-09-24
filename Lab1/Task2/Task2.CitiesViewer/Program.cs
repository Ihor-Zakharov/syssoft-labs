namespace Task2.CitiesViewer;

internal static class Program
{
    /// <summary>
    /// Optional argument: a connection string; otherwise the LAB1_TASK2_CONNECTION environment variable or LocalDB.
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var connectionString = ConnectionSettings.Resolve(args, Environment.GetEnvironmentVariable(ConnectionSettings.EnvironmentVariable));
        Application.Run(new MainForm(
            new CitiesRepository(connectionString),
            ConnectionSettings.Describe(connectionString),
            ConnectionSettings.DatabaseName(connectionString)));
    }
}
