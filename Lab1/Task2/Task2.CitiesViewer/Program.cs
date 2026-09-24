namespace Task2.CitiesViewer;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(new CitiesRepository(ConnectionSettings.ConnectionString)));
    }
}
