using MimeKit;

namespace Task4.Mailer.Tests;

public class LabMessageTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 24, 16, 5, 7, TimeSpan.FromHours(3));

    [Fact]
    public void BodyHasDateTimeNameAndSurname()
    {
        Assert.Equal("Date: 24.09.2026\r\nTime: 16:05:07\r\nName: Ihor\r\nSurname: Zakharov\r\n", LabMessage.Body(Now));
    }

    [Fact]
    public void MessageHasSubjectRecipientSenderNameAndDate()
    {
        var message = LabMessage.Create(MailboxAddress.Parse("me@gmail.com"), MailboxAddress.Parse("teacher@knu.ua"), "LAB-1", Now);

        Assert.Equal("LAB-1", message.Subject);
        Assert.Equal("teacher@knu.ua", message.To.Mailboxes.Single().Address);
        Assert.Equal("Ihor Zakharov", message.From.Mailboxes.Single().Name);
        Assert.Equal("me@gmail.com", message.From.Mailboxes.Single().Address);
        Assert.Equal(Now, message.Date);
        Assert.Equal(LabMessage.Body(Now), message.TextBody);
    }
}
