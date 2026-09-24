namespace Task1.Downloader.Tests;

public class ManualLightenerTests
{
    [Fact]
    public void ReplacesOnlyLinesContainingWord()
    {
        var (text, replaced) = ManualLightener.Lighten("alpha\r\nflashrom -p\r\nomega\r\n", "flashrom", wholeWord: false);

        Assert.Equal("alpha\r\nWORD FOUND!!!\r\nomega\r\n", text);
        Assert.Equal(1, replaced);
    }

    [Fact]
    public void IgnoresCase()
    {
        var (text, _) = ManualLightener.Lighten("Flashrom\nFLASHROM\nnothing", "flashrom", wholeWord: false);

        Assert.Equal("WORD FOUND!!!\nWORD FOUND!!!\nnothing", text);
    }

    [Fact]
    public void KeepsMixedLineEndingsAndLastLineWithoutNewline()
    {
        var (text, _) = ManualLightener.Lighten("a word\r\nb\nc word", "word", wholeWord: false);

        Assert.Equal("WORD FOUND!!!\r\nb\nWORD FOUND!!!", text);
    }

    [Fact]
    public void KeepsEmptyLines()
    {
        var (text, _) = ManualLightener.Lighten("\r\nword\r\n\r\n", "word", wholeWord: false);

        Assert.Equal("\r\nWORD FOUND!!!\r\n\r\n", text);
    }

    [Theory]
    [InlineData(false, 2)]
    [InlineData(true, 1)]
    public void WholeWordSkipsWordInsideOtherWords(bool wholeWord, int expected)
    {
        var (_, replaced) = ManualLightener.Lighten("the programmer\nprogram it\n", "program", wholeWord);

        Assert.Equal(expected, replaced);
    }

    [Fact]
    public void WholeWordWorksForWordsEndingWithSymbol()
    {
        var (_, replaced) = ManualLightener.Lighten("written in C++\nC++x\n", "C++", wholeWord: true);

        Assert.Equal(1, replaced);
    }

    [Fact]
    public void TreatsRegexCharactersLiterally()
    {
        var (_, replaced) = ManualLightener.Lighten("00:0d.0 device\n00x0d10\n", "0d.0", wholeWord: false);

        Assert.Equal(1, replaced);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void RejectsEmptyWord(string word)
    {
        Assert.ThrowsAny<ArgumentException>(() => ManualLightener.Lighten("text", word, wholeWord: false));
    }
}
