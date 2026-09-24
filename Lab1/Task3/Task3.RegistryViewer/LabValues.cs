using System.Globalization;

namespace Task3.RegistryViewer;

internal static class LabValues
{
    public const string P5 = "P5";
    public const string P6 = "P6";

    /// <summary>The two lines written to P6.</summary>
    public static string[] P6Lines(DateTime now) =>
    [
        "Ihor Zakharov",
        "Created by Lab1 Task3 at " + now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
    ];

    /// <summary>Text for a value that could not be read, with a hint how to fix it.</summary>
    public static string Explain(MultiStringValue value, string name, RegistryLocation location) => value.State switch
    {
        ValueState.KeyMissing =>
            $@"Key {location} does not exist. Import Lab1\Task3\registry\create-p5.reg (as administrator) first.",
        ValueState.ValueMissing =>
            $@"Value {name} not found in {location}. Import Lab1\Task3\registry\create-p5.reg first.",
        ValueState.WrongKind =>
            $"{name} is not of type MultiString (REG_MULTI_SZ).",
        _ => $"{name}: {value.Lines.Length} line(s)",
    };
}
