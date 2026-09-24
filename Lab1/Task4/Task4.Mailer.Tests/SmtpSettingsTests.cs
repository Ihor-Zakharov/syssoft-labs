using MailKit.Security;

namespace Task4.Mailer.Tests;

public class SmtpSettingsTests
{
    private static SmtpSettings? Load(out string? error, params (string Name, string Value)[] variables)
    {
        var environment = variables.ToDictionary(v => SmtpSettings.Prefix + v.Name, v => v.Value);
        return SmtpSettings.TryLoad(name => environment.GetValueOrDefault(name), out error);
    }

    [Fact]
    public void GmailIsTheDefaultAndNeedsOnlyUserAndPassword()
    {
        var settings = Load(out var error, ("USER", "me@gmail.com"), ("PASSWORD", "abcd efgh ijkl mnop"));

        Assert.Null(error);
        Assert.Equal("smtp.gmail.com", settings!.Host);
        Assert.Equal(587, settings.Port);
        Assert.Equal(SecureSocketOptions.StartTls, settings.SocketOptions);
        Assert.Equal("me@gmail.com", settings.From.Address);
    }

    [Fact]
    public void GmailWithoutCredentialsNamesBothVariables()
    {
        Assert.Null(Load(out var error));
        Assert.Contains("LAB1_SMTP_USER", error);
        Assert.Contains("LAB1_SMTP_PASSWORD", error);
        Assert.Contains("apppasswords", error);
    }

    [Fact]
    public void MailpitNeedsHostFromAndNoLogin()
    {
        var settings = Load(out var error, ("HOST", "localhost"), ("PORT", "1025"), ("SECURITY", "none"), ("FROM", "lab@example.com"));

        Assert.Null(error);
        Assert.Equal("localhost", settings!.Host);
        Assert.Equal(1025, settings.Port);
        Assert.Equal(SecureSocketOptions.None, settings.SocketOptions);
        Assert.Null(settings.User);
    }

    [Fact]
    public void ThePasswordIsNeverPrinted()
    {
        var settings = Load(out _, ("USER", "me@gmail.com"), ("PASSWORD", "s3cret-app-password"));

        Assert.DoesNotContain("s3cret", settings!.ToString());
    }
}
