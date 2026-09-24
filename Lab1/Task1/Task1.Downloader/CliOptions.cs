namespace Task1.Downloader;

internal sealed record CliOptions(string Word)
{
    public const string Usage = """
        Usage: Task1.Downloader <word>

        Downloads manual.txt into the current folder and writes Manual-LIGHT.txt next to it,
        where every line that contains <word> is replaced with "WORD FOUND!!!".
        Both files are overwritten on every run.
        """;

    /// <summary>Exactly one argument — the word. Returns null with an error message otherwise.</summary>
    public static CliOptions? TryParse(string[] args, out string? error)
    {
        if (args.Length != 1 || string.IsNullOrWhiteSpace(args[0]))
        {
            error = args.Length == 0 ? "No word given." : "Exactly one word is expected.";
            return null;
        }

        error = null;
        return new CliOptions(args[0].Trim());
    }
}
