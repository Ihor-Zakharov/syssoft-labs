using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;

namespace Task4.Mailer.Tests;

/// <summary>
/// Local Mailpit (Lab1/Task4/compose.yaml): SMTP on 127.0.0.1:1025, REST API on 127.0.0.1:8025.
/// If it is not running, <see cref="UnavailableReason"/> is set and the integration tests are skipped.
/// </summary>
public sealed class MailpitFixture : IAsyncLifetime
{
    public const string Host = "127.0.0.1";
    public const int SmtpPort = 1025;

    private readonly HttpClient _api = new() { BaseAddress = new Uri("http://127.0.0.1:8025/api/v1/"), Timeout = TimeSpan.FromSeconds(5) };

    public string? UnavailableReason { get; private set; }

    public async Task InitializeAsync()
    {
        try
        {
            using var tcp = new TcpClient();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await tcp.ConnectAsync(Host, SmtpPort, timeout.Token);
            (await _api.GetAsync("info")).EnsureSuccessStatusCode();
        }
        catch (Exception ex)
        {
            UnavailableReason = $"Mailpit is not running ({ex.Message}). Start it: docker compose -f Lab1/Task4/compose.yaml up -d";
        }
    }

    public Task DisposeAsync()
    {
        _api.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>Polls the search API until a message with this exact subject has arrived.</summary>
    public async Task<string> WaitForMessageAsync(string subject)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            using var result = JsonDocument.Parse(await _api.GetStringAsync($"search?query={Uri.EscapeDataString($"subject:\"{subject}\"")}"));
            foreach (var message in result.RootElement.GetProperty("messages").EnumerateArray())
            {
                if (message.GetProperty("Subject").GetString() == subject)
                {
                    return message.GetProperty("ID").GetString()!;
                }
            }

            await Task.Delay(100);
        }

        throw new TimeoutException($"No message with subject '{subject}' arrived in Mailpit.");
    }

    public async Task<JsonElement> GetMessageAsync(string id)
    {
        using var document = JsonDocument.Parse(await _api.GetStringAsync($"message/{id}"));
        return document.RootElement.Clone();
    }

    public async Task DeleteAsync(string id)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, "messages") { Content = JsonContent.Create(new { IDs = new[] { id } }) };
        (await _api.SendAsync(request)).EnsureSuccessStatusCode();
    }
}
