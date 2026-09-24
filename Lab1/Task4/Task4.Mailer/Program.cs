using System.Net.Sockets;
using System.Text;
using MailKit.Net.Smtp;
using MailKit.Security;

namespace Task4.Mailer;

internal static class Program
{
    private const int ExitOk = 0;
    private const int ExitFailure = 1;
    private const int ExitUsage = 2;

    private static async Task<int> Main(string[] args)
    {
        try
        {
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

        var settings = SmtpSettings.TryLoad(Environment.GetEnvironmentVariable, out error);
        if (settings is null)
        {
            Console.Error.WriteLine($"SMTP is not configured: {error}");
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

        var message = LabMessage.Create(settings.From, options.To, options.Subject, DateTimeOffset.Now);
        try
        {
            var reply = await new MailSender(settings).SendAsync(message, cts.Token);
            Console.WriteLine($"Sent \"{options.Subject}\" to {options.To.Address} via {settings}");
            Console.WriteLine($"Server reply: {reply}");
            return ExitOk;
        }
        catch (AuthenticationException ex)
        {
            Console.Error.WriteLine($"Login to {settings.Host} failed: {ex.Message}");
            Console.Error.WriteLine("For Gmail use an app password (https://myaccount.google.com/apppasswords), not the account password.");
        }
        catch (SmtpCommandException ex)
        {
            Console.Error.WriteLine($"The server refused the message ({(int)ex.StatusCode} {ex.StatusCode}): {ex.Message}");
        }
        catch (SslHandshakeException ex)
        {
            Console.Error.WriteLine($"TLS with {settings.Host}:{settings.Port} failed: {ex.Message}");
            Console.Error.WriteLine("Check LAB1_SMTP_SECURITY and LAB1_SMTP_PORT (starttls usually goes with 587, ssl with 465).");
        }
        catch (Exception ex) when (ex is SocketException or SmtpProtocolException or IOException or TimeoutException)
        {
            Console.Error.WriteLine($"Cannot talk to {settings.Host}:{settings.Port}: {ex.Message}");
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("Cancelled.");
        }

        return ExitFailure;
    }
}
