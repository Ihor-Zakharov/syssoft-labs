using Microsoft.Win32;

namespace Task3.RegistryViewer.Tests;

public class LocationAndValuesTests
{

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
}
