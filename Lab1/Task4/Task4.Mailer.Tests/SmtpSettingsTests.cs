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
    public void DefaultsToPort587AndAutoSecurity()
    {
        var settings = Load(out var error, ("HOST", "smtp.gmail.com"), ("USER", "me@gmail.com"), ("PASSWORD", "abcd efgh ijkl mnop"));

        Assert.Null(error);
        Assert.Equal(587, settings!.Port);
        Assert.Equal(SmtpSecurity.Auto, settings.Security);
        Assert.Equal("me@gmail.com", settings.From.Address);
        Assert.Equal("abcd efgh ijkl mnop", settings.Password);
    }

    [Fact]
    public void SslDefaultsToPort465()
    {
        var settings = Load(out _, ("HOST", "smtp.example.com"), ("SECURITY", "SSL"), ("FROM", "lab@example.com"));

        Assert.Equal(465, settings!.Port);
        Assert.Equal(SecureSocketOptions.SslOnConnect, settings.SocketOptions);
    }

    [Theory]
    [InlineData("auto", SecureSocketOptions.Auto)]
    [InlineData("starttls", SecureSocketOptions.StartTls)]
    [InlineData("none", SecureSocketOptions.None)]
    public void MapsSecurityToMailKitOptions(string security, SecureSocketOptions expected)
    {
        var settings = Load(out _, ("HOST", "localhost"), ("SECURITY", security), ("FROM", "lab@example.com"));

        Assert.Equal(expected, settings!.SocketOptions);
    }

    [Fact]
    public void MailpitNeedsNoLogin()
    {
        var settings = Load(out var error, ("HOST", "localhost"), ("PORT", "1025"), ("SECURITY", "none"), ("FROM", "lab@example.com"));

        Assert.Null(error);
        Assert.Null(settings!.User);
        Assert.Equal(1025, settings.Port);
    }

    [Fact]
    public void DescriptionNeverContainsThePassword()
    {
        var settings = Load(out _, ("HOST", "smtp.gmail.com"), ("USER", "me@gmail.com"), ("PASSWORD", "s3cret-app-password"));

        Assert.DoesNotContain("s3cret", settings!.ToString());
        Assert.Contains("smtp.gmail.com:587", settings.ToString());
    }

    public static TheoryData<(string, string)[]> InvalidSettings =>
    [
        [],
        [("PORT", "587")],
        [("HOST", "localhost"), ("PORT", "0"), ("FROM", "lab@example.com")],
        [("HOST", "localhost"), ("PORT", "smtp"), ("FROM", "lab@example.com")],
        [("HOST", "localhost"), ("SECURITY", "tls1.3"), ("FROM", "lab@example.com")],
        [("HOST", "localhost"), ("USER", "me@gmail.com")],
        [("HOST", "localhost"), ("PASSWORD", "secret"), ("FROM", "lab@example.com")],
        [("HOST", "localhost")],
        [("HOST", "localhost"), ("FROM", "not-an-address")],
    ];

    [Theory]
    [MemberData(nameof(InvalidSettings))]
    public void InvalidSettingsAreExplained((string, string)[] variables)
    {
        Assert.Null(Load(out var error, variables));
        Assert.Contains(SmtpSettings.Prefix, error);
    }
}
