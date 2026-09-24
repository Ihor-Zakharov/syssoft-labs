using System.Net;
using System.Text;

namespace Task1.Downloader.Tests;

public sealed class ManualDownloaderTests : IDisposable
{
    private const string Manual = "Probing Test\r\nflashrom -p internal\r\nDone\r\n";

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "task1-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, recursive: true);
        }
    }

    [Fact]
    public async Task WritesOriginalAndLightFiles()
    {
        var result = await RunAsync(StubHandler.Ok(Manual), "flashrom");

        Assert.Equal(Encoding.ASCII.GetBytes(Manual), await File.ReadAllBytesAsync(result.ManualPath));
        Assert.Equal("Probing Test\r\nWORD FOUND!!!\r\nDone\r\n", await File.ReadAllTextAsync(result.LightPath));
        Assert.Equal(1, result.ReplacedLines);
        Assert.Equal("utf-8", result.Encoding);
        Assert.Equal(ManualDownloader.LightFileName, Path.GetFileName(result.LightPath));
    }

    [Fact]
    public async Task OverwritesExistingFiles()
    {
        Directory.CreateDirectory(_dir);
        var stale = new string('x', 10_000);
        await File.WriteAllTextAsync(Path.Combine(_dir, ManualDownloader.ManualFileName), stale);
        await File.WriteAllTextAsync(Path.Combine(_dir, ManualDownloader.LightFileName), stale);

        var result = await RunAsync(StubHandler.Ok(Manual), "Done");

        Assert.Equal(Manual, await File.ReadAllTextAsync(result.ManualPath));
        Assert.Equal("Probing Test\r\nflashrom -p internal\r\nWORD FOUND!!!\r\n", await File.ReadAllTextAsync(result.LightPath));
    }

    [Fact]
    public async Task KeepsBytesOfUnchangedLinesInNonUtf8File()
    {
        // "café" in Windows-1252 / Latin-1: 0xE9 is not valid UTF-8
        byte[] original = [.. "caf"u8, 0xE9, .. "\r\nflashrom\r\n"u8];

        var result = await RunAsync(new StubHandler(HttpStatusCode.OK, original), "flashrom");

        Assert.Equal("iso-8859-1", result.Encoding);
        Assert.Equal([.. "caf"u8, 0xE9, .. "\r\nWORD FOUND!!!\r\n"u8], await File.ReadAllBytesAsync(result.LightPath));
    }

    [Fact]
    public async Task HttpErrorWritesNothing()
    {
        await Assert.ThrowsAsync<HttpRequestException>(() => RunAsync(new StubHandler(HttpStatusCode.NotFound, []), "flashrom"));

        Assert.False(Directory.Exists(_dir));
    }

    private Task<DownloadResult> RunAsync(HttpMessageHandler handler, string word)
    {
        var options = new CliOptions(word, new Uri("https://example.test/manual.txt"), _dir, WholeWord: false);
        return new ManualDownloader(new HttpClient(handler)).RunAsync(options, CancellationToken.None);
    }

    private sealed class StubHandler(HttpStatusCode status, byte[] body) : HttpMessageHandler
    {
        public static StubHandler Ok(string body) => new(HttpStatusCode.OK, Encoding.ASCII.GetBytes(body));

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new ByteArrayContent(body) });
    }
}
