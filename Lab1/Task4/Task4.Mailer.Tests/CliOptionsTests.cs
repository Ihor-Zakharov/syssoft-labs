namespace Task4.Mailer.Tests;

public class CliOptionsTests
{
    [Fact]
    public void ParsesRecipientAndSubject()
    {
        var options = CliOptions.TryParse(["teacher@knu.ua", "LAB-1"], out var error);

        Assert.Null(error);
        Assert.Equal("teacher@knu.ua", options!.To.Address);
        Assert.Equal("LAB-1", options.Subject);
        Assert.False(options.DryRun);
        Assert.False(options.Trace);
    }

    [Fact]
    public void ParsesFlagsInAnyPosition()
    {
        var options = CliOptions.TryParse(["--trace", "teacher@knu.ua", "--dry-run", "LAB-1"], out _);

        Assert.True(options!.DryRun);
        Assert.True(options.Trace);
    }

    [Fact]
    public void DoubleDashAllowsSubjectStartingWithDash()
    {
        var options = CliOptions.TryParse(["teacher@knu.ua", "--", "-LAB-1-"], out var error);

        Assert.Null(error);
        Assert.Equal("-LAB-1-", options!.Subject);
    }

    [Theory]
    [InlineData("-h")]
    [InlineData("--help")]
    public void HelpIsNotAnError(string flag)
    {
        Assert.Null(CliOptions.TryParse(["teacher@knu.ua", flag], out var error));
        Assert.Null(error);
    }

    public static TheoryData<string[]> InvalidArgs =>
    [
        [],
        ["teacher@knu.ua"],
        ["teacher@knu.ua", "LAB-1", "extra"],
        ["teacher@knu.ua", "   "],
        ["teacher@knu.ua", "LAB-1", "--verbose"],
        ["not-an-address", "LAB-1"],
        ["teacher@localhost", "LAB-1"],
        ["@knu.ua", "LAB-1"],
        ["Teacher <teacher@knu.ua>", "LAB-1"],
        ["a@knu.ua, b@knu.ua", "LAB-1"],
    ];

    [Theory]
    [MemberData(nameof(InvalidArgs))]
    public void InvalidArgumentsGiveError(string[] args)
    {
        Assert.Null(CliOptions.TryParse(args, out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }
}
