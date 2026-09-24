using Microsoft.Win32;

namespace Task3.RegistryViewer;

/// <summary>
/// Hive + subkey of the lab key. The 64-bit view is used explicitly: a 32-bit process would otherwise be redirected
/// to HKLM\SOFTWARE\WOW6432Node\Zakharov and not see the key created by 64-bit regedit.
/// </summary>
internal sealed record RegistryLocation(RegistryHive Hive, string SubKey)
{
    public static readonly RegistryLocation Lab = new(RegistryHive.LocalMachine, @"SOFTWARE\Zakharov");

    public const RegistryView View = RegistryView.Registry64;

    public override string ToString() => $@"{HiveName(Hive)}\{SubKey}";

    /// <summary>Parses "HKLM\SOFTWARE\Zakharov" or "HKCU\Software\Something" (full hive names work too).</summary>
    public static RegistryLocation? TryParse(string text)
    {
        var separator = text.IndexOf('\\');
        if (separator <= 0 || separator == text.Length - 1)
        {
            return null;
        }

        RegistryHive? hive = text[..separator].ToUpperInvariant() switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => RegistryHive.LocalMachine,
            "HKCU" or "HKEY_CURRENT_USER" => RegistryHive.CurrentUser,
            _ => null,
        };

        var subKey = text[(separator + 1)..].Trim('\\');
        return hive is null || subKey.Length == 0 ? null : new RegistryLocation(hive.Value, subKey);
    }

    private static string HiveName(RegistryHive hive) => hive switch
    {
        RegistryHive.LocalMachine => "HKLM",
        RegistryHive.CurrentUser => "HKCU",
        _ => hive.ToString(),
    };
}
