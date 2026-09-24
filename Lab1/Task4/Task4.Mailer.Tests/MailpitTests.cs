using MimeKit;

namespace Task4.Mailer.Tests;

public sealed class MailpitTests(MailpitFixture mailpit) : IClassFixture<MailpitFixture>
{
    private static readonly SmtpSettings Mailpit = new(
        MailpitFixture.Host, MailpitFixture.SmtpPort, SmtpSecurity.None, User: null, Password: null, MailboxAddress.Parse("lab@example.com"));

    [SkippableFact]
    public async Task SentMessageArrivesWithSubjectRecipientAndLabText()
    {
        Skip.If(mailpit.UnavailableReason is not null, mailpit.UnavailableReason);

        var subject = "LAB-1 " + Guid.NewGuid().ToString("N")[..8];
        var now = new DateTimeOffset(2026, 9, 24, 16, 5, 7, TimeSpan.FromHours(3));
        var message = LabMessage.Create(Mailpit.From, MailboxAddress.Parse("teacher@example.com"), subject, now);

        var reply = await new MailSender(Mailpit).SendAsync(message, CancellationToken.None);
        var id = await mailpit.WaitForMessageAsync(subject);
        try
        {
            var stored = await mailpit.GetMessageAsync(id);

            Assert.False(string.IsNullOrWhiteSpace(reply));
            Assert.Equal(subject, stored.GetProperty("Subject").GetString());
            Assert.Equal("teacher@example.com", stored.GetProperty("To")[0].GetProperty("Address").GetString());
            Assert.Equal("Ihor Zakharov", stored.GetProperty("From").GetProperty("Name").GetString());
            var text = stored.GetProperty("Text").GetString()!.ReplaceLineEndings("\n");
            Assert.Contains("Date: 24.09.2026\nTime: 16:05:07\nName: Ihor\nSurname: Zakharov", text);
        }
        finally
        {
            await mailpit.DeleteAsync(id);
        }
    }
}
