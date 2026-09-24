using MailKit.Security;
using MimeKit;

namespace Task4.Mailer;

internal enum SmtpSecurity
{
    Auto,
    StartTls,
    Ssl,
    None,
}

/// <summary>Where and how to send. The password comes only from the environment and is never printed.</summary>
internal sealed record SmtpSettings(string Host, int Port, SmtpSecurity Security, string? User, string? Password, MailboxAddress From)
{
    public const string Prefix = "LAB1_SMTP_";

    /// <summary>Real mail goes through Gmail unless another server is configured.</summary>
    public const string DefaultHost = "smtp.gmail.com";

    public const string AppPasswordsUrl = "https://myaccount.google.com/apppasswords";

    public SecureSocketOptions SocketOptions => Security switch
    {
        SmtpSecurity.StartTls => SecureSocketOptions.StartTls,     // plain connection, then STARTTLS (port 587)
        SmtpSecurity.Ssl => SecureSocketOptions.SslOnConnect,       // TLS from the first byte (port 465)
        SmtpSecurity.None => SecureSocketOptions.None,              // local test servers only (Mailpit)
        _ => SecureSocketOptions.Auto,                              // SSL on 465, STARTTLS if offered otherwise
    };

    /// <summary>Safe to print: no password.</summary>
    public override string ToString() => $"{Host}:{Port} ({Security}{(User is null ? ", no auth" : $", user {User}")})";

    public static SmtpSettings? TryLoad(Func<string, string?> environment, out string? error)
    {
        string? Get(string name) => environment(Prefix + name) is { } value && value.Trim().Length > 0 ? value.Trim() : null;

        var customHost = Get("HOST");
        var host = customHost ?? DefaultHost;

        // Gmail on 587 needs STARTTLS; a custom server keeps "auto" unless told otherwise
        var securityText = Get("SECURITY") ?? (customHost is null ? "starttls" : "auto");
        SmtpSecurity? security = securityText.ToLowerInvariant() switch
        {
            "auto" => SmtpSecurity.Auto,
            "starttls" => SmtpSecurity.StartTls,
            "ssl" => SmtpSecurity.Ssl,
            "none" => SmtpSecurity.None,
            _ => null,
        };
        if (security is null)
        {
            error = $"{Prefix}SECURITY must be auto, starttls, ssl or none (got '{securityText}').";
            return null;
        }

        var port = security == SmtpSecurity.Ssl ? 465 : 587;
        if (Get("PORT") is { } portText && (!int.TryParse(portText, out port) || port is < 1 or > 65535))
        {
            error = $"{Prefix}PORT must be a number from 1 to 65535 (got '{portText}').";
            return null;
        }

        var user = Get("USER");
        // The password is taken as is: spaces may be part of it (Gmail shows app passwords in groups of four)
        var password = environment(Prefix + "PASSWORD") is { Length: > 0 } secret ? secret : null;
        if ((user is null) != (password is null))
        {
            error = $"Set both {Prefix}USER and {Prefix}PASSWORD, or neither (for servers without login).";
            return null;
        }

        if (customHost is null && user is null)
        {
            error = $"Gmail needs a login: set {Prefix}USER (your Gmail address) and {Prefix}PASSWORD (an app password, " +
                    $"{AppPasswordsUrl}). For a local test server such as Mailpit set {Prefix}HOST and {Prefix}FROM instead.";
            return null;
        }

        var fromText = Get("FROM") ?? user;
        if (fromText is null || !CliOptions.TryParseAddress(fromText, out var from))
        {
            error = fromText is null
                ? $"{Prefix}FROM is not set (and there is no {Prefix}USER to use instead)."
                : $"{Prefix}FROM is not a valid address: {fromText}";
            return null;
        }

        error = null;
        return new SmtpSettings(host, port, security.Value, user, password, from);
    }
}
