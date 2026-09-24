using System.Text;

namespace Task1.Downloader;

internal static class TextCodec
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>
    /// Detects the encoding of a downloaded text: byte order mark first, then strict UTF-8 (covers ASCII),
    /// otherwise Latin-1. Latin-1 maps every byte to a character, so re-encoding gives back the same bytes
    /// and lines that are not replaced stay exactly as they were, whatever the real 8-bit code page is.
    /// </summary>
    public static (string Text, Encoding Encoding) Decode(byte[] bytes)
    {
        Encoding? withBom = bytes switch
        {
            [0xEF, 0xBB, 0xBF, ..] => new UTF8Encoding(encoderShouldEmitUTF8Identifier: true),
            [0xFF, 0xFE, 0x00, 0x00, ..] => new UTF32Encoding(bigEndian: false, byteOrderMark: true),
            [0xFF, 0xFE, ..] => new UnicodeEncoding(bigEndian: false, byteOrderMark: true),
            [0xFE, 0xFF, ..] => new UnicodeEncoding(bigEndian: true, byteOrderMark: true),
            _ => null,
        };

        if (withBom is not null)
        {
            var bomLength = withBom.GetPreamble().Length;
            return (withBom.GetString(bytes, bomLength, bytes.Length - bomLength), withBom);
        }

        try
        {
            return (StrictUtf8.GetString(bytes), StrictUtf8);
        }
        catch (DecoderFallbackException)
        {
            return (Encoding.Latin1.GetString(bytes), Encoding.Latin1);
        }
    }

    /// <summary>Encodes the text back, with the same byte order mark if the original had one.</summary>
    public static byte[] Encode(string text, Encoding encoding) => [.. encoding.GetPreamble(), .. encoding.GetBytes(text)];
}
