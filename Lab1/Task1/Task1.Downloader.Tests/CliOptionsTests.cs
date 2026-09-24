namespace Task1.Downloader.Tests;

public class CliOptionsTests
{
    [Fact]
    public void TheWordIsTheOnlyArgument()
    {
        var options = CliOptions.TryParse(["flashrom"], out var error);

        Assert.Null(error);
        Assert.Equal("flashrom", options!.Word);
    }

    [Theory]
    [InlineData(new object[] { new string[0] })]
    [InlineData(new object[] { new[] { "flashrom", "extra" } })]
    [InlineData(new object[] { new[] { "   " } })]
    public void WithoutExactlyOneWordThereIsAnError(string[] args)
    {
        Assert.Null(CliOptions.TryParse(args, out var error));
        Assert.False(string.IsNullOrEmpty(error));
    }
}
