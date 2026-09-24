namespace Task2.CitiesViewer;

internal static class Program
{
    /// <summary>
    /// Optional argument: a connection string; otherwise the LAB1_TASK2_CONNECTION environment variable or LocalDB.
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var connectionString = ConnectionSettings.Resolve(args, Environment.GetEnvironmentVariable(ConnectionSettings.EnvironmentVariable));

        ConnectionInfo connection;
        try
        {
            connection = ConnectionSettings.Parse(connectionString);
        }
        catch (ArgumentException ex)
        {
            MessageBox.Show(
                $"The connection string is not valid:\n{ex.Message}\n\n" +
                $"Pass a valid one as the first argument or in {ConnectionSettings.EnvironmentVariable}, or pass nothing to use LocalDB.",
                "Invalid connection string", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        Application.Run(new MainForm(new CitiesRepository(connectionString), connection));
        return 0;
    }
}
