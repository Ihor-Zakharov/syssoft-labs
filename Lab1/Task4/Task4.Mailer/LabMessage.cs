using System.Globalization;
using MimeKit;
using MimeKit.Text;

namespace Task4.Mailer;

internal static class LabMessage
{
    public const string FirstName = "Ihor";
    public const string LastName = "Zakharov";

    /// <summary>
    /// The text required by the assignment: date, time, first name and last name. Lines end with CRLF, as email
    /// requires (RFC 5322) — built explicitly so the result does not depend on the source file's line endings.
    /// </summary>
    public static string Body(DateTimeOffset now) => string.Join("\r\n",
    [
        "Date: " + now.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture),
        "Time: " + now.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
        "Name: " + FirstName,
        "Surname: " + LastName,
        "",
    ]);

    public static MimeMessage Create(MailboxAddress from, MailboxAddress to, string subject, DateTimeOffset now)
    {
        var message = new MimeMessage
        {
            Subject = subject,
            Date = now,
            Body = new TextPart(TextFormat.Plain) { Text = Body(now) },
        };
        message.From.Add(new MailboxAddress($"{FirstName} {LastName}", from.Address));
        message.To.Add(to);
        return message;
    }
}
