using System.Text;

namespace Task1.Downloader;

internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitFailure = 1;
    private const int ExitUsage = 2;

    private static async Task<int> Main(string[] args)
    {
        // The default Windows console code page cannot print many non-ASCII characters (paths, search words)
        Console.OutputEncoding = Encoding.UTF8;

        var options = CliOptions.TryParse(args, out var error);
        if (options is null)
        {
            if (error is null)
            {
                Console.WriteLine(CliOptions.Usage);
                return ExitOk;
            }

            // Error and usage go to one stream (stderr), otherwise they interleave in the console
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
        try
        {
            var result = await new ManualDownloader(http).RunAsync(options, cts.Token);
            Console.WriteLine($"Downloaded: {result.ManualPath}");
            Console.WriteLine($"Light:      {result.LightPath} (lines replaced: {result.ReplacedLines})");
            return ExitOk;
        }
        catch (HttpRequestException ex)
        {
            Console.Error.WriteLine($"Failed to download {options.Url}: {ex.Message}");
        }
        catch (TaskCanceledException) when (!cts.IsCancellationRequested)
        {
            Console.Error.WriteLine($"Server {options.Url.Host} did not respond in time.");
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Cancelled.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to write file: {ex.Message}");
        }

        return ExitFailure;
    }
}
