namespace Task4.Mailer.Tests;

public class CliOptionsTests
{
    [Fact]
    public void RecipientAndSubjectAreTheTwoArguments()
    {
        var options = CliOptions.TryParse(["teacher@knu.ua", "LAB-1"], out var error);

        Assert.Null(error);
        Assert.Equal("teacher@knu.ua", options!.To.Address);
        Assert.Equal("LAB-1", options.Subject);
    }

    public static TheoryData<string[]> InvalidArgs =>
    [
        [],
        ["teacher@knu.ua"],
        ["teacher@knu.ua", "LAB-1", "extra"],
        ["teacher@knu.ua", "   "],
        ["not-an-address", "LAB-1"],
        ["teacher@localhost", "LAB-1"],
        ["Teacher <teacher@knu.ua>", "LAB-1"],
    ];

    [Theory]
    [MemberData(nameof(InvalidArgs))]
    public void WithoutBothValidArgumentsThereIsAnError(string[] args)
    {
        Assert.Null(CliOptions.TryParse(args, out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }
}
