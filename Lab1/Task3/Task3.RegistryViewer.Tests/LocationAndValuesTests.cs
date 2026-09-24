using Microsoft.Win32;

namespace Task3.RegistryViewer.Tests;

public class LocationAndValuesTests
{
    [Theory]
    [InlineData(@"HKLM\SOFTWARE\Zakharov", RegistryHive.LocalMachine, @"SOFTWARE\Zakharov")]
    [InlineData(@"hkcu\Software\Demo\", RegistryHive.CurrentUser, @"Software\Demo")]
    [InlineData(@"HKEY_CURRENT_USER\Software\Demo", RegistryHive.CurrentUser, @"Software\Demo")]
    public void ParsesKeyPaths(string text, RegistryHive hive, string subKey)
    {
        Assert.Equal(new RegistryLocation(hive, subKey), RegistryLocation.TryParse(text));
    }

    [Theory]
    [InlineData("")]
    [InlineData("HKLM")]
    [InlineData(@"HKLM\")]
    [InlineData(@"HKCR\Something")]
    [InlineData(@"Software\Zakharov")]
    public void RejectsInvalidKeyPaths(string text)
    {
        Assert.Null(RegistryLocation.TryParse(text));
    }

    [Fact]
    public void LabKeyIsHklmSoftwareZakharov()
    {
        Assert.Equal(@"HKLM\SOFTWARE\Zakharov", RegistryLocation.Lab.ToString());
        Assert.Equal(RegistryView.Registry64, RegistryLocation.View);
    }

    [Fact]
    public void P6HasExactlyTwoNonEmptyLines()
    {
        var lines = LabValues.P6Lines(new DateTime(2026, 9, 24, 14, 5, 9));

        Assert.Equal(["Ihor Zakharov", "Created by Lab1 Task3 at 2026-09-24 14:05:09"], lines);
    }

    // ValueState is internal, so the theory takes its name (a public test method cannot expose an internal type)
    [Theory]
    [InlineData(nameof(ValueState.KeyMissing), "create-p5.reg")]
    [InlineData(nameof(ValueState.ValueMissing), "create-p5.reg")]
    [InlineData(nameof(ValueState.WrongKind), "expected MultiString")]
    [InlineData(nameof(ValueState.Ok), "P5: 2 line(s)")]
    public void ExplainsEveryState(string stateName, string expected)
    {
        var state = Enum.Parse<ValueState>(stateName);
        var value = new MultiStringValue(state, state == ValueState.Ok ? ["a", "b"] : [], RegistryValueKind.String);

        Assert.Contains(expected, LabValues.Explain(value, "P5", RegistryLocation.Lab));
    }
}
