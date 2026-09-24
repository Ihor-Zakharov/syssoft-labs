# Task4 — send an email from the command line

## How to demo

1. `powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To <real address>` — asks for your Gmail
   address and app password (hidden) and sends `LAB-1`; show the message in the recipient's inbox or in Gmail → Sent.
2. Or on GitHub: **Actions → Send Lab1 email → Run workflow**, enter the recipient — sent from GitHub, no password on the PC.
3. `Task4.Mailer.exe` without arguments prints the usage.

## What it does

Console program that sends an email whose text contains the current **date, time, first name and last name**. Two
arguments are required — the recipient address and the subject (the assignment uses `LAB-1`); without them the program
prints help. Messages go to real mailboxes through **Gmail**.

![The message](docs/mailpit-message.png)

## Usage

```
Task4.Mailer <to> <subject>
```

The message:

```
Subject: LAB-1

Date: 24.09.2026
Time: 16:30:42
Name: Ihor
Surname: Zakharov
```

Exit codes: `0` — sent, `1` — sending failed, `2` — missing/invalid arguments or settings.

## Sending through Gmail

Prerequisites (once): Google account → Security → **2-Step Verification** on, then create an **app password** at
<https://myaccount.google.com/apppasswords> — Gmail rejects the normal account password for SMTP.

Gmail (`smtp.gmail.com:587`, STARTTLS) is the default server, so only two environment variables are needed — never
put the password into the code or the command line:

| Variable | Meaning |
|---|---|
| `LAB1_SMTP_USER` | your Gmail address (also the sender) |
| `LAB1_SMTP_PASSWORD` | the app password |

`send-gmail.ps1` sets them only for its own process from a hidden prompt and removes them afterwards:

```powershell
powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua
```

### From GitHub Actions (no password on the PC)

The workflow `.github/workflows/send-lab1-email.yml` runs the program on a GitHub runner:
**Actions → Send Lab1 email → Run workflow**, enter the recipient (subject defaults to `LAB-1`). It works only from
`main`. One-time setup — the password goes straight into GitHub's encrypted secrets and is masked in logs:

```powershell
gh variable set LAB1_SMTP_USER --body "<your gmail address>"
gh secret set LAB1_SMTP_PASSWORD        # asks for the app password with hidden input
```

## Testing without sending real mail (Mailpit)

[Mailpit](https://mailpit.axllent.org/) is an SMTP server in Docker that catches every message and shows it in a web
UI — used by the integration test and for trying the program offline. Point the program at it with `LAB1_SMTP_HOST`:

```bash
# WSL
docker compose -f /mnt/c/Users/Ihor/projects/syssoft-labs/Lab1/Task4/compose.yaml up -d
```

```powershell
# PowerShell
$env:LAB1_SMTP_HOST = "localhost"; $env:LAB1_SMTP_PORT = "1025"; $env:LAB1_SMTP_SECURITY = "none"
$env:LAB1_SMTP_FROM = "lab@example.com"
dotnet run --project Lab1\Task4\Task4.Mailer -- teacher@knu.ua LAB-1
```

Open <http://localhost:8025> to see the message. Other servers: `LAB1_SMTP_PORT` (default 587, 465 with
`LAB1_SMTP_SECURITY=ssl`), `LAB1_SMTP_SECURITY` (`auto` / `starttls` / `ssl` / `none`), `LAB1_SMTP_FROM`
(required when there is no login).

## How sending works (SMTP)

```
C: EHLO my-pc                          introduce ourselves
C: STARTTLS  … TLS handshake …         (Gmail, port 587) — everything below is encrypted
C: AUTH PLAIN …                        login with the app password
C: MAIL FROM:<me@gmail.com>            envelope sender
C: RCPT TO:<teacher@knu.ua>            envelope recipient
C: DATA                                then the headers (From, To, Subject, Date), an empty line and the text
C: .                                   a line with a single dot ends the message
S: 250 OK                              accepted
C: QUIT
```

The program uses MailKit (Microsoft recommends it instead of the old `System.Net.Mail.SmtpClient`). The text is
built with CRLF line endings, as email requires.

## Tests

```
dotnet test ../Lab1.slnx
```

They check the assignment: both arguments are required and validated; the message has the subject, the recipient,
the sender name and a text with the date, time, first and last name; Gmail is the default and needs only the two
variables; the password is never printed. One integration test sends a real message to Mailpit and checks it through
Mailpit's API (skipped when Mailpit is not running).
