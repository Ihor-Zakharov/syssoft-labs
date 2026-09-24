using System.Text;

namespace Task1.Downloader.Tests;

public class TextCodecTests
{
    public static TheoryData<byte[], string, string> Samples => new()
    {
        { "abc\r\n"u8.ToArray(), "abc\r\n", "utf-8" },
        { "Київ"u8.ToArray(), "Київ", "utf-8" },
        { [0xEF, 0xBB, 0xBF, .. "abc"u8], "abc", "utf-8" },
        { [0xFF, 0xFE, (byte)'a', 0x00], "a", "utf-16" },
        { [0xFE, 0xFF, 0x00, (byte)'a'], "a", "utf-16BE" },
        { [(byte)'c', (byte)'a', (byte)'f', 0xE9], "café", "iso-8859-1" },
    };

    [Theory]
    [MemberData(nameof(Samples))]
    public void DecodesAndRoundTripsBytes(byte[] bytes, string expectedText, string expectedEncoding)
    {
        var (text, encoding) = TextCodec.Decode(bytes);

        Assert.Equal(expectedText, text);
        Assert.Equal(expectedEncoding, encoding.WebName);
        Assert.Equal(bytes, TextCodec.Encode(text, encoding));
    }

    [Fact]
    public void KeepsUnknownCodePageBytesUntouched()
    {
        // Windows-1251 "Київ" is not valid UTF-8; Latin-1 still gives back the exact bytes
        var cp1251 = new byte[] { 0xCA, 0xE8, 0xBF, 0xE2, (byte)'\n', (byte)'o', (byte)'k' };

        var (text, encoding) = TextCodec.Decode(cp1251);

        Assert.Same(Encoding.Latin1, encoding);
        Assert.Equal(cp1251, TextCodec.Encode(text, encoding));
    }
}
