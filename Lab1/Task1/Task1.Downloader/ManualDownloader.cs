namespace Task1.Downloader;

internal sealed record DownloadResult(string ManualPath, string LightPath, int ReplacedLines, string Encoding);

internal sealed class ManualDownloader(HttpClient http)
{
    public const string ManualFileName = "manual.txt";
    public const string LightFileName = "Manual-LIGHT.txt";

    public static HttpClient CreateClient(string pinnedSha256)
    {
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, certificate, _, errors) =>
                CertificatePinning.Validate(certificate, errors, pinnedSha256),
        };

        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };
    }

    public async Task<DownloadResult> RunAsync(CliOptions options, CancellationToken cancellationToken)
    {
        var bytes = await http.GetByteArrayAsync(options.Url, cancellationToken);

        Directory.CreateDirectory(options.OutputDir);
        var manualPath = Path.GetFullPath(Path.Combine(options.OutputDir, ManualFileName));
        var lightPath = Path.GetFullPath(Path.Combine(options.OutputDir, LightFileName));

        // The original is saved byte for byte; both files are overwritten on every run
        await File.WriteAllBytesAsync(manualPath, bytes, cancellationToken);

        // The light file keeps the original encoding, so unchanged lines stay byte-identical
        var (text, encoding) = TextCodec.Decode(bytes);
        var (light, replaced) = ManualLightener.Lighten(text, options.Word, options.WholeWord);
        await File.WriteAllBytesAsync(lightPath, TextCodec.Encode(light, encoding), cancellationToken);

        return new DownloadResult(manualPath, lightPath, replaced, encoding.WebName);
    }
}
