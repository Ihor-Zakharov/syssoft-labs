using MimeKit;

namespace Task4.Mailer;

internal sealed record CliOptions(MailboxAddress To, string Subject, bool DryRun, bool Trace)
{
    public const string Usage = """
        Usage: Task4.Mailer [options] [--] <to> <subject>

          <to>          recipient address, e.g. teacher@knu.ua
          <subject>     subject line, e.g. LAB-1
          --dry-run     print the message instead of sending it (no SMTP settings needed)
          --trace       print the SMTP conversation to stderr (passwords are redacted)
          -h, --help    show this help

        SMTP settings are read from environment variables (never from the command line):
          LAB1_SMTP_HOST      server, e.g. smtp.gmail.com, or localhost for Mailpit
          LAB1_SMTP_PORT      default 587 (465 when LAB1_SMTP_SECURITY=ssl)
          LAB1_SMTP_SECURITY  auto | starttls | ssl | none   (default auto)
          LAB1_SMTP_USER      login; together with LAB1_SMTP_PASSWORD
          LAB1_SMTP_PASSWORD  password (for Gmail: an app password)
          LAB1_SMTP_FROM      sender address (default: LAB1_SMTP_USER)
        """;

    /// <summary>
    /// Returns null when the program should not run: error == null means help was requested, otherwise the arguments are invalid.
    /// </summary>
    public static CliOptions? TryParse(string[] args, out string? error)
    {
        var positional = new List<string>();
        var dryRun = false;
        var trace = false;
        var onlyPositionalFollow = false;

        foreach (var arg in args)
        {
            if (onlyPositionalFollow || !arg.StartsWith('-'))
            {
                positional.Add(arg);
                continue;
            }

            switch (arg)
            {
                case "--":
                    onlyPositionalFollow = true;
                    break;
                case "-h" or "--help":
                    error = null;
                    return null;
                case "--dry-run":
                    dryRun = true;
                    break;
                case "--trace":
                    trace = true;
                    break;
                default:
                    error = $"Unknown option: {arg}";
                    return null;
            }
        }

        if (positional.Count != 2)
        {
            error = positional.Count < 2
                ? "Both the recipient address and the subject are required."
                : "Expected exactly two arguments: <to> <subject>. Put a subject with spaces in quotes.";
            return null;
        }

        if (!TryParseAddress(positional[0], out var to))
        {
            error = $"Not a valid email address: {positional[0]}";
            return null;
        }

        var subject = positional[1].Trim();
        if (subject.Length == 0)
        {
            error = "The subject must not be empty.";
            return null;
        }

        error = null;
        return new CliOptions(to, subject, dryRun, trace);
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
