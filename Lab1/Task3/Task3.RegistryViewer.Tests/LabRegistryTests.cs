using Microsoft.Win32;

namespace Task3.RegistryViewer.Tests;

public sealed class LabRegistryTests : IDisposable
{
    private readonly TempRegistryKey _temp = new();

    public void Dispose() => _temp.Dispose();

    [Fact]
    public void MissingKeyIsReportedNotThrown()
    {
        var value = new LabRegistry(_temp.Location).ReadMultiString("P5");

        Assert.Equal(ValueState.KeyMissing, value.State);
        Assert.Empty(value.Lines);
    }

    [Fact]
    public void MissingValueIsReported()
    {
        using (_temp.Create())
        {
        }

        Assert.Equal(ValueState.ValueMissing, new LabRegistry(_temp.Location).ReadMultiString("P5").State);
    }

    [Fact]
    public void ValueOfOtherTypeIsReported()
    {
        using (var key = _temp.Create())
        {
            key.SetValue("P5", "just a string", RegistryValueKind.String);
        }

        var value = new LabRegistry(_temp.Location).ReadMultiString("P5");

        Assert.Equal(ValueState.WrongKind, value.State);
        Assert.Equal(RegistryValueKind.String, value.Kind);
    }

    [Fact]
    public void ReadsAllLinesOfMultiString()
    {
        using (var key = _temp.Create())
        {
            key.SetValue("P5", new[] { "one", "Київ", "%PATH% stays as is" }, RegistryValueKind.MultiString);
        }

        var value = new LabRegistry(_temp.Location).ReadMultiString("p5");

        Assert.Equal(ValueState.Ok, value.State);
        Assert.Equal(["one", "Київ", "%PATH% stays as is"], value.Lines);
    }

    [Fact]
    public void WriteCreatesKeyAndMultiStringValue()
    {
        var registry = new LabRegistry(_temp.Location);

        registry.WriteMultiString("P6", ["first", "second"]);

        using var key = Registry.CurrentUser.OpenSubKey(_temp.SubKey);
        Assert.Equal(RegistryValueKind.MultiString, key!.GetValueKind("P6"));
        Assert.Equal(["first", "second"], (string[])key.GetValue("P6")!);
    }

    [Fact]
    public void WriteOverwritesExistingValue()
    {
        var registry = new LabRegistry(_temp.Location);
        registry.WriteMultiString("P6", ["old", "old", "old"]);

        registry.WriteMultiString("P6", ["new 1", "new 2"]);

        Assert.Equal(["new 1", "new 2"], registry.ReadMultiString("P6").Lines);
    }

    [Theory]
    [InlineData("")]
    [InlineData("a\0b")]
    public void WriteRejectsLinesThatWouldBreakMultiString(string bad)
    {
        var registry = new LabRegistry(_temp.Location);

        Assert.Throws<ArgumentException>(() => registry.WriteMultiString("P6", ["ok", bad, "lost"]));
        Assert.Equal(ValueState.KeyMissing, registry.ReadMultiString("P6").State);
    }
}
