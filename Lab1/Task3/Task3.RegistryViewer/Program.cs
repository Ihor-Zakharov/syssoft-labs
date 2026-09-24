namespace Task3.RegistryViewer;

internal static class Program
{
    /// <summary>
    /// Works with HKLM\SOFTWARE\Zakharov. "--key HKCU\Software\Something" points it to another key
    /// (for trying the program without administrator rights).
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        var location = RegistryLocation.Lab;
        if (args.Length > 0)
        {
            if (args is not ["--key", var key] || RegistryLocation.TryParse(key) is not { } parsed)
            {
                MessageBox.Show(@"Usage: Task3.RegistryViewer [--key HKLM\SOFTWARE\Zakharov | HKCU\Software\...]",
                    "Invalid arguments", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            location = parsed;
        }

        Application.Run(new MainForm(new LabRegistry(location), args));
        return 0;
    }
}
