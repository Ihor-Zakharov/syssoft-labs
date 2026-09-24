using System.Diagnostics;

namespace Task3.RegistryViewer.Tests;

public sealed class RegFileTests : IDisposable
{
    private static readonly string[] ExpectedP5 = ["Ihor Zakharov", "Лабораторна робота 1", "System software"];

    private readonly TempRegistryKey _temp = new();

    public void Dispose() => _temp.Dispose();

    [Fact]
    public void CreateP5TargetsTheLabKey()
    {
        var reg = File.ReadAllText(RegFile("create-p5.reg"));

        Assert.StartsWith("Windows Registry Editor Version 5.00", reg);
        Assert.Contains(@"[HKEY_LOCAL_MACHINE\SOFTWARE\Zakharov]", reg);
    }

    [Fact]
    public void RegExeImportsP5WithAllLines()
    {
        // The same file, redirected to a temporary HKCU key so the import needs no administrator rights
        var reg = File.ReadAllText(RegFile("create-p5.reg"))
            .Replace(@"[HKEY_LOCAL_MACHINE\SOFTWARE\Zakharov]", $@"[HKEY_CURRENT_USER\{_temp.SubKey}]");
        var file = Path.Combine(Path.GetTempPath(), $"task3-{Guid.NewGuid():N}.reg");
        File.WriteAllText(file, reg);
        try
        {
            RunRegExe($"import \"{file}\"");
        }
        finally
        {
            File.Delete(file);
        }

        var value = new LabRegistry(_temp.Location).ReadMultiString("P5");

        Assert.Equal(ValueState.Ok, value.State);
        Assert.Equal(ExpectedP5, value.Lines);
    }

    [Fact]
    public void DeleteFileRemovesTheLabKey()
    {
        Assert.Contains(@"[-HKEY_LOCAL_MACHINE\SOFTWARE\Zakharov]", File.ReadAllText(RegFile("delete-zakharov.reg")));
    }

    private static string RegFile(string name) => Path.Combine(AppContext.BaseDirectory, "registry", name);

    private static void RunRegExe(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo("reg.exe", arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        })!;
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        Assert.True(process.ExitCode == 0, $"reg.exe {arguments} failed: {error}");
    }
}
