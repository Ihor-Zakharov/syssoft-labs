namespace Task1.Downloader.Tests;

public class CliOptionsTests
{
    [Fact]
    public void WordOnlyUsesDefaults()
    {
        var options = CliOptions.TryParse(["flashrom"], out var error);

        Assert.Null(error);
        Assert.Equal(new CliOptions("flashrom", CliOptions.DefaultUrl, ".", WholeWord: false), options);
    }

    [Fact]
    public void ParsesAllOptionsInAnyOrder()
    {
        var options = CliOptions.TryParse(
            ["--whole-word", "--url", "https://example.com/m.txt", "flashrom", "--output-dir", "out"], out var error);

        Assert.Null(error);
        Assert.Equal(new CliOptions("flashrom", new Uri("https://example.com/m.txt"), "out", WholeWord: true), options);
    }

    [Theory]
    [InlineData("-p")]
    [InlineData("--help")]
    [InlineData("--")]
    public void DoubleDashAllowsWordStartingWithDash(string word)
    {
        var options = CliOptions.TryParse(["--whole-word", "--", word], out var error);

        Assert.Null(error);
        Assert.Equal(word, options?.Word);
        Assert.True(options?.WholeWord);
    }

    [Theory]
    [InlineData("-h")]
    [InlineData("--help")]
    public void HelpIsNotAnError(string flag)
    {
        var options = CliOptions.TryParse(["flashrom", flag], out var error);

        Assert.Null(options);
        Assert.Null(error);
    }

    public static TheoryData<string[]> InvalidArgs =>
    [
        [],
        ["--whole-word"],
        ["one", "two"],
        ["--", "one", "two"],
        ["word", "--verbose"],
        ["word", "-p"],
        ["word", "--output-dir"],
        ["word", "--output-dir", ""],
        ["word", "--output-dir", "   "],
        ["word", "--url", "ftp://example.com/m.txt"],
        ["word", "--url", "not a url"],
        ["word", "--url", ""],
    ];

    [Theory]
    [MemberData(nameof(InvalidArgs))]
    public void InvalidArgumentsGiveError(string[] args)
    {
        var options = CliOptions.TryParse(args, out var error);

        Assert.Null(options);
        Assert.False(string.IsNullOrEmpty(error));
    }
}
