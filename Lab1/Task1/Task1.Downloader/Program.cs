using System.Text;

namespace Task1.Downloader;

internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitFailure = 1;
    private const int ExitUsage = 2;

    private static async Task<int> Main(string[] args)
    {
        try
        {
            // The default Windows console code page cannot print many non-ASCII characters (paths, words)
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException)
        {
            // No console attached: keep the default encoding
        }

        var options = CliOptions.TryParse(args, out var error);
        if (options is null)
        {
            Console.Error.WriteLine(error);
            Console.Error.WriteLine();
            Console.Error.WriteLine(CliOptions.Usage);
            return ExitUsage;
        }

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        using var http = ManualDownloader.CreateClient(CertificatePinning.ManualServerSha256);
        var url = ManualDownloader.ManualUrl;
        try
        {
            // Files go to the current folder: run the program from a folder (e.g. in Far) and both files appear there
            var result = await new ManualDownloader(http).RunAsync(url, options.Word, Environment.CurrentDirectory, cts.Token);
            Console.WriteLine($"Downloaded: {result.ManualPath}");
            Console.WriteLine($"Light:      {result.LightPath} (lines replaced: {result.ReplacedLines})");
            return ExitOk;
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Failed to download {url}: {ex.Message}");
        }
        catch (TaskCanceledException) when (!cts.IsCancellationRequested)
        {
            Console.Error.WriteLine($"Server {url.Host} did not respond in time.");
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Cancelled.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to write the files in {Environment.CurrentDirectory}: {ex.Message}");
        }

        return ExitFailure;
    }
}
