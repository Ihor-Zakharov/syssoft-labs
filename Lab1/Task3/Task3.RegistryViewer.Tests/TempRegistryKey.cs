using Microsoft.Win32;

namespace Task3.RegistryViewer.Tests;

/// <summary>A throw-away key under HKCU (no administrator rights needed), deleted with everything inside.</summary>
public sealed class TempRegistryKey : IDisposable
{
    public string SubKey { get; } = @"Software\Task3Tests_" + Guid.NewGuid().ToString("N");

    internal RegistryLocation Location => new(RegistryHive.CurrentUser, SubKey);

    /// <summary>Creates the key; the caller disposes the returned key. The hive handle is closed right away.</summary>
    public RegistryKey Create()
    {
        using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryLocation.View);
        return baseKey.CreateSubKey(SubKey, writable: true);
    }

    public void Dispose()
    {
        using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryLocation.View);
        baseKey.DeleteSubKeyTree(SubKey, throwOnMissingSubKey: false);
    }
}
