namespace Task1.Downloader.Tests;

public class ManualLightenerTests
{
    [Fact]
    public void ReplacesOnlyLinesContainingTheWord()
    {
        var (text, replaced) = ManualLightener.Lighten("alpha\r\nrun flashrom -p\r\nomega\r\n", "flashrom");

        Assert.Equal("alpha\r\nWORD FOUND!!!\r\nomega\r\n", text);
        Assert.Equal(1, replaced);
    }

    [Fact]
    public void IgnoresCase()
    {
        var (_, replaced) = ManualLightener.Lighten("Flashrom\nFLASHROM\nnothing\n", "flashrom");

        Assert.Equal(2, replaced);
    }

    [Fact]
    public void MatchesTheWholeWordOnly()
    {
        var (text, _) = ManualLightener.Lighten("the programmer\nprogram it\n", "program");

        Assert.Equal("the programmer\nWORD FOUND!!!\n", text);
    }

    [Fact]
    public void KeepsOtherLinesAndLineEndings()
    {
        var (text, _) = ManualLightener.Lighten("\r\nword\r\nkept as is\nlast word", "word");

        Assert.Equal("\r\nWORD FOUND!!!\r\nkept as is\nWORD FOUND!!!", text);
    }
}
