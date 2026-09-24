using MailKit.Net.Smtp;
using MimeKit;

namespace Task4.Mailer;

internal sealed class MailSender(SmtpSettings settings)
{
    /// <summary>Connects, logs in if configured, sends and says goodbye. Returns the server's reply to the message.</summary>
    public async Task<string> SendAsync(MimeMessage message, CancellationToken cancellationToken)
    {
        using var client = new SmtpClient { Timeout = 30_000 };

        await client.ConnectAsync(settings.Host, settings.Port, settings.SocketOptions, cancellationToken);
        if (settings is { User: { } user, Password: { } password })
        {
            await client.AuthenticateAsync(user, password, cancellationToken);
        }

        var reply = await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(quit: true, cancellationToken);
        return reply;
    }
}
