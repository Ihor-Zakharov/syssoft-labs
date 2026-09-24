using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Task1.Downloader.Tests;

public sealed class CertificatePinningTests : IDisposable
{
    private readonly X509Certificate2 _certificate = CreateSelfSigned("CN=test.local");

    public void Dispose() => _certificate.Dispose();

    [Fact]
    public void AcceptsValidCertificateWithoutCheckingPin()
    {
        Assert.True(CertificatePinning.Validate(_certificate, SslPolicyErrors.None, pinnedSha256: "00"));
    }

    [Fact]
    public void AcceptsInvalidCertificateWhenFingerprintMatchesPin()
    {
        var pin = _certificate.GetCertHashString(HashAlgorithmName.SHA256).ToLowerInvariant();

        Assert.True(CertificatePinning.Validate(
            _certificate, SslPolicyErrors.RemoteCertificateNameMismatch | SslPolicyErrors.RemoteCertificateChainErrors, pin));
    }

    [Fact]
    public void RejectsInvalidCertificateWithOtherFingerprint()
    {
        using var other = CreateSelfSigned("CN=attacker.local");
        var pin = _certificate.GetCertHashString(HashAlgorithmName.SHA256);

        Assert.False(CertificatePinning.Validate(other, SslPolicyErrors.RemoteCertificateChainErrors, pin));
    }

    [Fact]
    public void RejectsMissingCertificate()
    {
        Assert.False(CertificatePinning.Validate(
            null, SslPolicyErrors.RemoteCertificateNotAvailable, CertificatePinning.ManualServerSha256));
    }

    private static X509Certificate2 CreateSelfSigned(string subject)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest(subject, key, HashAlgorithmName.SHA256);
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
    }
}
