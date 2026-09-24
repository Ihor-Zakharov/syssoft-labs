using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Task1.Downloader;

internal static class CertificatePinning
{
    /// <summary>
    /// SHA-256 of the manual.txt server certificate. It is issued for mail.univ.net.ua and expired on 2026-08-20,
    /// while we connect by IP, so standard validation fails and we trust exactly this certificate instead.
    /// </summary>
    public const string ManualServerSha256 = "7F96A64D03536BC384D4CF118B4BB52DB1E906372FE73B81BF771BF90226B378";

    public static bool Validate(X509Certificate2? certificate, SslPolicyErrors errors, string pinnedSha256)
    {
        if (errors == SslPolicyErrors.None)
        {
            return true;
        }

        if (certificate is null)
        {
            return false;
        }

        var actual = certificate.GetCertHashString(HashAlgorithmName.SHA256);
        return string.Equals(actual, pinnedSha256, StringComparison.OrdinalIgnoreCase);
    }
}
