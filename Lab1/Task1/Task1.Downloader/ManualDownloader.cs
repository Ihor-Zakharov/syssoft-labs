using System.Text;

namespace Task1.Downloader;

internal sealed record DownloadResult(string ManualPath, string LightPath, int ReplacedLines);

internal sealed class ManualDownloader(HttpClient http)
{
    public const string ManualFileName = "manual.txt";
    public const string LightFileName = "Manual-LIGHT.txt";

    /// <summary>
    /// The address from the assignment (mail.univ.net.ua/manual.txt) answers 404; the file is served by IP.
    /// </summary>
    public static readonly Uri ManualUrl = new("https://91.202.128.107/manual.txt");

    public static HttpClient CreateClient(string pinnedSha256)
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, certificate, _, errors) =>
                CertificatePinning.Validate(certificate, errors, pinnedSha256),
        };

        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    }

    /// <summary>Downloads the manual into <paramref name="folder"/> and writes the light copy next to it.</summary>
    public async Task<DownloadResult> RunAsync(Uri url, string word, string folder, CancellationToken cancellationToken)
    {
        var bytes = await http.GetByteArrayAsync(url, cancellationToken);

        var manualPath = Path.Combine(folder, ManualFileName);
        var lightPath = Path.Combine(folder, LightFileName);

        // The original is saved byte for byte; both files are overwritten on every run
        await File.WriteAllBytesAsync(manualPath, bytes, cancellationToken);

        var (light, replaced) = ManualLightener.Lighten(Encoding.UTF8.GetString(bytes), word);
        await File.WriteAllTextAsync(lightPath, light, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), cancellationToken);

        return new DownloadResult(manualPath, lightPath, replaced);
    }
}
