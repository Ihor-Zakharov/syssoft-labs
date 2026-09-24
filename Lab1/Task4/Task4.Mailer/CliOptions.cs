using MimeKit;

namespace Task4.Mailer;

internal sealed record CliOptions(MailboxAddress To, string Subject)
{
    public const string Usage = """
        Usage: Task4.Mailer <to> <subject>

          <to>        recipient address, e.g. teacher@knu.ua
          <subject>   subject line, e.g. LAB-1

        Sends an email with the current date, time, first and last name.
        SMTP settings are read from environment variables:
          LAB1_SMTP_HOST      server, e.g. smtp.gmail.com (localhost for Mailpit)
          LAB1_SMTP_PORT      default 587 (465 when LAB1_SMTP_SECURITY=ssl)
          LAB1_SMTP_SECURITY  auto | starttls | ssl | none   (default auto)
          LAB1_SMTP_USER      login; together with LAB1_SMTP_PASSWORD
          LAB1_SMTP_PASSWORD  password (for Gmail: an app password)
          LAB1_SMTP_FROM      sender address (default: LAB1_SMTP_USER)
        """;

    /// <summary>Both arguments are required. Returns null with an error message otherwise.</summary>
    public static CliOptions? TryParse(string[] args, out string? error)
    {
        if (args.Length != 2)
        {
            error = args.Length < 2
                ? "Both the recipient address and the subject are required."
                : "Expected exactly two arguments: <to> <subject>. Put a subject with spaces in quotes.";
            return null;
        }

        if (!TryParseAddress(args[0], out var to))
        {
            error = $"Not a valid email address: {args[0]}";
            return null;
        }

        var subject = args[1].Trim();
        if (subject.Length == 0)
        {
            error = "The subject must not be empty.";
            return null;
        }

        error = null;
        return new CliOptions(to, subject);
    }

    /// <summary>A single plain address like user@example.com (no display name, no lists).</summary>
    public static bool TryParseAddress(string text, out MailboxAddress address)
    {
        address = null!;
        if (!MailboxAddress.TryParse(text.Trim(), out var parsed) || !string.IsNullOrEmpty(parsed.Name))
        {
            return false;
        }

        var at = parsed.Address.IndexOf('@');
        if (at <= 0 || at == parsed.Address.Length - 1 || !parsed.Address[(at + 1)..].Contains('.'))
        {
            return false;
        }

        address = parsed;
        return true;
    }
}
