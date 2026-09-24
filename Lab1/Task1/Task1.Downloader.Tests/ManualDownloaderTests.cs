using System.Net;
using System.Text;

namespace Task1.Downloader.Tests;

public sealed class ManualDownloaderTests : IDisposable
{
    private const string Manual = "Probing Test\r\nflashrom -p internal\r\nDone\r\n";

    private readonly string _folder = Directory.CreateTempSubdirectory("task1-tests-").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public async Task WritesBothFilesIntoTheFolder()
    {
        var result = await RunAsync("flashrom");

        Assert.Equal(Path.Combine(_folder, "manual.txt"), result.ManualPath);
        Assert.Equal(Path.Combine(_folder, "Manual-LIGHT.txt"), result.LightPath);
        Assert.Equal(Encoding.ASCII.GetBytes(Manual), await File.ReadAllBytesAsync(result.ManualPath));
        Assert.Equal("Probing Test\r\nWORD FOUND!!!\r\nDone\r\n", await File.ReadAllTextAsync(result.LightPath));
        Assert.Equal(1, result.ReplacedLines);
    }

    [Fact]
    public async Task OverwritesBothFilesOnEveryRun()
    {
        var stale = new string('x', 10_000);
        await File.WriteAllTextAsync(Path.Combine(_folder, "manual.txt"), stale);
        await File.WriteAllTextAsync(Path.Combine(_folder, "Manual-LIGHT.txt"), stale);

        var result = await RunAsync("Done");

        Assert.Equal(Manual, await File.ReadAllTextAsync(result.ManualPath));
        Assert.Equal("Probing Test\r\nflashrom -p internal\r\nWORD FOUND!!!\r\n", await File.ReadAllTextAsync(result.LightPath));
    }

    private Task<DownloadResult> RunAsync(string word) =>
        new ManualDownloader(new HttpClient(new StubHandler()))
            .RunAsync(new Uri("https://example.test/manual.txt"), word, _folder, CancellationToken.None);

    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.ASCII.GetBytes(Manual)) });
    }
}
