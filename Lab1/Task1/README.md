# Task1 — download a file and make a "light" copy

## How to demo

1. `cd C:\Temp\lab1` (any folder; in Far just open it) and run `Task1.Downloader.exe flashrom`
2. The folder now has `manual.txt` and `Manual-LIGHT.txt` — open the second one: 17 lines are `WORD FOUND!!!`
3. Run it again: both files are overwritten; without a word the program prints the usage

## What it does

Console program that downloads `manual.txt` and writes, **into the current folder**:

- `manual.txt` — the original, byte for byte;
- `Manual-LIGHT.txt` — the same text where every line containing the word from the command line is replaced with
  `WORD FOUND!!!`.

Both files are overwritten on every run.

## Usage

```
Task1.Downloader <word>
```

The word is matched as a whole word and case-insensitively (`flashrom` finds `Flashrom`, `program` does not match
`programmer`). Run it from any folder — for example in Far, go to the folder and type
`C:\...\Task1.Downloader.exe flashrom` — and both files appear in that folder's panel.

```
> Task1.Downloader flashrom
Downloaded: C:\Temp\lab1\manual.txt
Light:      C:\Temp\lab1\Manual-LIGHT.txt (lines replaced: 17)
```

Exit codes: `0` — done, `1` — download or write failed, `2` — no word or more than one argument.

## Why the address differs from the assignment

The address from the assignment (`mail.univ.net.ua/manual.txt`) answers 404; the file is served at
`https://91.202.128.107/manual.txt`. That server presents a certificate issued for `mail.univ.net.ua` that expired on
2026-08-20, and we connect by IP, so standard TLS validation fails twice (name mismatch and expiry).

Instead of accepting any certificate (which would disable TLS protection entirely), `CertificatePinning` accepts an
invalid certificate **only** if its SHA-256 fingerprint equals the known one (`7F:96:A6:4D:…:26:B3:78`). A certificate
that passes normal validation is always accepted.

## Tests

```
dotnet test ../Lab1.slnx
```

They check exactly the assignment: one word is required; lines with the word (whole word, any case) are replaced
and all other lines and line endings stay as they were; both files are written into the folder and overwritten on the
next run; and the certificate check accepts only the pinned certificate (with generated self-signed certificates).
No network access is needed — HTTP is replaced by a stub handler.
