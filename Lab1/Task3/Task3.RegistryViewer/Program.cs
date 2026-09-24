namespace Task3.RegistryViewer;

internal static class Program
{
    /// <summary>Works with HKLM\SOFTWARE\Zakharov: reading P5 needs no rights, creating P6 needs administrator rights.</summary>
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(new LabRegistry(RegistryLocation.Lab)));
    }
}
