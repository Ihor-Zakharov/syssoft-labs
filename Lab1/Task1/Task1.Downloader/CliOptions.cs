namespace Task1.Downloader;

internal sealed record CliOptions(string Word, Uri Url, string OutputDir, bool WholeWord)
{
    public static readonly Uri DefaultUrl = new("https://91.202.128.107/manual.txt");

    public const string Usage = """
        Usage: Task1.Downloader [options] [--] <word>

          <word>         lines containing this word are replaced with "WORD FOUND!!!"
          --output-dir   where to save manual.txt and Manual-LIGHT.txt (default: current directory)
          --whole-word   match the whole word only, not a part of another word
          --url          where to download the file from (default: https://91.202.128.107/manual.txt)
          --             everything after it is the word, even if it starts with "-" (e.g. -- -p)
          -h, --help     show this help
        """;

    /// <summary>
    /// Returns null when the program should not run: error == null means help was requested, otherwise the arguments are invalid.
    /// </summary>
    public static CliOptions? TryParse(string[] args, out string? error)
    {
        string? word = null;
        var url = DefaultUrl;
        var outputDir = ".";
        var wholeWord = false;
        var onlyWordsFollow = false;

        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];

            if (onlyWordsFollow || !arg.StartsWith('-'))
            {
                if (word is not null)
                {
                    error = "Exactly one search word is expected.";
                    return null;
                }

                word = arg;
                continue;
            }

            switch (arg)
            {
                case "--":
                    onlyWordsFollow = true;
                    break;

                case "-h" or "--help":
                    error = null;
                    return null;

                case "--whole-word":
                    wholeWord = true;
                    break;

                case "--output-dir" or "--url":
                    if (i + 1 >= args.Length || string.IsNullOrWhiteSpace(args[i + 1]))
                    {
                        error = $"Option {arg} requires a value.";
                        return null;
                    }

                    var value = args[++i];
                    if (arg == "--output-dir")
                    {
                        outputDir = value;
                    }
                    else if (!Uri.TryCreate(value, UriKind.Absolute, out url!) ||
                             (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp))
                    {
                        error = $"Invalid URL: {value}";
                        return null;
                    }

                    break;

                default:
                    error = $"Unknown option: {arg}";
                    return null;
            }
        }

        if (string.IsNullOrWhiteSpace(word))
        {
            error = "No search word given.";
            return null;
        }

        error = null;
        return new CliOptions(word, url, outputDir, wholeWord);
    }
}
