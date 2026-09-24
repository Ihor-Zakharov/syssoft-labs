# Task1 — download a file and make a "light" copy

Console program that downloads `manual.txt` over HTTPS and writes two files:

- `manual.txt` — the original, byte for byte;
- `Manual-LIGHT.txt` — the same text where every line containing the search word is replaced with `WORD FOUND!!!`.

Both files are overwritten on every run.

## Usage

```
Task1.Downloader [options] [--] <word>

  <word>         lines containing this word are replaced with "WORD FOUND!!!"
  --output-dir   where to save manual.txt and Manual-LIGHT.txt (default: current directory)
  --whole-word   match the whole word only, not a part of another word
  --url          where to download the file from (default: https://91.202.128.107/manual.txt)
  --             everything after it is the word, even if it starts with "-" (e.g. -- -p)
  -h, --help     show this help
```

```
> Task1.Downloader flashrom --output-dir out
Downloaded: C:\...\out\manual.txt
Light:      C:\...\out\Manual-LIGHT.txt (lines replaced: 17, encoding: utf-8)
```

Exit codes: `0` — success, `1` — download or write failed, `2` — invalid arguments.

## Design notes

**Certificate pinning.** The address from the assignment (`mail.univ.net.ua/manual.txt`) returns 404; the file is served
at `https://91.202.128.107/manual.txt`. That server presents a certificate issued for `mail.univ.net.ua` that expired on
2026-08-20, and we connect by IP, so standard TLS validation fails twice (name mismatch and expiry). Instead of accepting
any certificate, `CertificatePinning` accepts an invalid certificate only if its SHA-256 fingerprint equals the known one
(`7F:96:A6:4D:…:26:B3:78`). A certificate that passes normal validation is always accepted.

**Matching.** Case-insensitive; the word is escaped, so characters like `.` or `+` are literal. `--whole-word` uses
`(?<!\w)word(?!\w)` instead of `\b`, which also works for words such as `C++`.

**Fidelity.** Line endings (CRLF, LF, a trailing lone CR) are kept. The encoding is detected (BOM, then strict UTF-8,
otherwise Latin-1) and the light file is written in the same encoding, so unchanged lines stay byte-identical.

## Tests

```
dotnet test ../Lab1.slnx
```

Unit tests cover argument parsing, line replacement, encoding detection, certificate pinning (with generated
self-signed certificates) and the downloader with a stub HTTP handler — no network access needed.
