using System.Text;
using System.Text.RegularExpressions;

namespace Task1.Downloader;

internal static class ManualLightener
{
    public const string Marker = "WORD FOUND!!!";

    /// <summary>
    /// Replaces every line that contains the word with <see cref="Marker"/>. The word is matched as a whole word
    /// ("program" does not match "programmer") and case-insensitively; line endings are kept as in the original.
    /// </summary>
    public static (string Text, int Replaced) Lighten(string text, string word)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(word);

        // Regex.Escape: characters like "." in the word are literal. (?<!\w) and (?!\w) instead of \b:
        // a whole word also when it starts or ends with a non-letter (C++, .NET)
        var regex = new Regex($@"(?<!\w){Regex.Escape(word)}(?!\w)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        var result = new StringBuilder(text.Length);
        var replaced = 0;
        var start = 0;
        while (start < text.Length)
        {
            var newline = text.IndexOf('\n', start);
            var end = newline < 0 ? text.Length : newline + 1;
            var eolLength = newline < 0 ? 0 : (newline > start && text[newline - 1] == '\r' ? 2 : 1);

            var line = text.AsSpan(start, end - start - eolLength);
            if (regex.IsMatch(line))
            {
                result.Append(Marker);
                replaced++;
            }
            else
            {
                result.Append(line);
            }

            result.Append(text.AsSpan(end - eolLength, eolLength));
            start = end;
        }

        return (result.ToString(), replaced);
    }
}
