namespace Task4.Mailer.Tests;

public class SmtpSettingsTests
{
    private static SmtpSettings? Load(out string? error, params (string Name, string Value)[] variables)
    {
        var environment = variables.ToDictionary(v => SmtpSettings.Prefix + v.Name, v => v.Value);
        return SmtpSettings.TryLoad(name => environment.GetValueOrDefault(name), out error);
    }

    [Fact]
    public void GmailSettings()
    {
        var settings = Load(out var error, ("HOST", "smtp.gmail.com"), ("USER", "me@gmail.com"), ("PASSWORD", "abcd efgh ijkl mnop"));

        Assert.Null(error);
        Assert.Equal(587, settings!.Port);
        Assert.Equal("me@gmail.com", settings.From.Address);
    }

    [Fact]
    public void MailpitNeedsNoLogin()
    {
        var settings = Load(out var error, ("HOST", "localhost"), ("PORT", "1025"), ("SECURITY", "none"), ("FROM", "lab@example.com"));

        Assert.Null(error);
        Assert.Null(settings!.User);
    }

    [Fact]
    public void WithoutHostThereIsAnError()
    {
        Assert.Null(Load(out var error));
        Assert.Contains("LAB1_SMTP_HOST", error);
    }

    [Fact]
    public void ThePasswordIsNeverPrinted()
    {
        var settings = Load(out _, ("HOST", "smtp.gmail.com"), ("USER", "me@gmail.com"), ("PASSWORD", "s3cret-app-password"));

        Assert.DoesNotContain("s3cret", settings!.ToString());
    }
}
