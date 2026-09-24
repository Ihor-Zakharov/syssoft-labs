using Microsoft.Win32;

namespace Task3.RegistryViewer;

internal enum ValueState
{
    Ok,
    KeyMissing,
    ValueMissing,
    WrongKind,
}

internal sealed record MultiStringValue(ValueState State, string[] Lines);

internal sealed class LabRegistry(RegistryLocation location)
{
    public RegistryLocation Location => location;

    /// <summary>Reads a REG_MULTI_SZ value; opens the key read-only, so it works without administrator rights.</summary>
    public MultiStringValue ReadMultiString(string name)
    {
        using var baseKey = RegistryKey.OpenBaseKey(location.Hive, RegistryLocation.View);
        using var key = baseKey.OpenSubKey(location.SubKey, writable: false);
        if (key is null)
        {
            return new MultiStringValue(ValueState.KeyMissing, []);
        }

        // One read decides the state: a REG_MULTI_SZ value comes back as string[]
        return key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) switch
        {
            null => new MultiStringValue(ValueState.ValueMissing, []),
            string[] lines => new MultiStringValue(ValueState.Ok, lines),
            _ => new MultiStringValue(ValueState.WrongKind, []),
        };
    }

    /// <summary>
    /// Creates or overwrites a REG_MULTI_SZ value, creating the key if needed.
    /// Under HKLM this needs administrator rights, otherwise <see cref="UnauthorizedAccessException"/> is thrown.
    /// </summary>
    public void WriteMultiString(string name, IReadOnlyList<string> lines)
    {
        using var baseKey = RegistryKey.OpenBaseKey(location.Hive, RegistryLocation.View);
        using var key = baseKey.CreateSubKey(location.SubKey, writable: true);
        key.SetValue(name, lines.ToArray(), RegistryValueKind.MultiString);
    }
}
