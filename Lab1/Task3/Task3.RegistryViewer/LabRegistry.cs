using Microsoft.Win32;

namespace Task3.RegistryViewer;

internal enum ValueState
{
    Ok,
    KeyMissing,
    ValueMissing,
    WrongKind,
}

internal sealed record MultiStringValue(ValueState State, string[] Lines, RegistryValueKind? Kind = null);

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

        // One read decides the state: the CLR type of the returned object follows the registry type
        // (REG_MULTI_SZ -> string[]), so there is no window between "does it exist", "which type" and "read"
        // in which another process could delete or retype the value
        var data = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        return data switch
        {
            null => new MultiStringValue(ValueState.ValueMissing, []),
            string[] lines => new MultiStringValue(ValueState.Ok, lines, RegistryValueKind.MultiString),
            _ => new MultiStringValue(ValueState.WrongKind, [], KindForMessage(key, name, data)),
        };
    }

    /// <summary>Exact registry type for the error message; if the value vanished meanwhile, a type inferred from the data.</summary>
    private static RegistryValueKind KindForMessage(RegistryKey key, string name, object data)
    {
        try
        {
            return key.GetValueKind(name);
        }
        catch (IOException)
        {
            return data switch
            {
                string => RegistryValueKind.String,
                int => RegistryValueKind.DWord,
                long => RegistryValueKind.QWord,
                byte[] => RegistryValueKind.Binary,
                _ => RegistryValueKind.Unknown,
            };
        }
    }

    /// <summary>
    /// Creates or overwrites a REG_MULTI_SZ value, creating the key if needed.
    /// Under HKLM this needs administrator rights, otherwise <see cref="UnauthorizedAccessException"/> is thrown.
    /// </summary>
    public void WriteMultiString(string name, IReadOnlyList<string> lines)
    {
        // REG_MULTI_SZ is "a\0b\0\0": an empty string would end the list early and hide the lines after it
        if (lines.Any(line => line.Length == 0 || line.Contains('\0')))
        {
            throw new ArgumentException("REG_MULTI_SZ cannot contain empty strings or NUL characters.", nameof(lines));
        }

        using var baseKey = RegistryKey.OpenBaseKey(location.Hive, RegistryLocation.View);
        using var key = baseKey.CreateSubKey(location.SubKey, writable: true);
        key.SetValue(name, lines.ToArray(), RegistryValueKind.MultiString);
    }
}
