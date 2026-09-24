# Task4 — send an email from the command line

## How to demo

1. Start Mailpit (WSL): `docker compose -f /mnt/c/Users/Ihor/projects/syssoft-labs/Lab1/Task4/compose.yaml up -d`
2. PowerShell: `$env:LAB1_SMTP_HOST="localhost"; $env:LAB1_SMTP_PORT="1025"; $env:LAB1_SMTP_SECURITY="none"; $env:LAB1_SMTP_FROM="ihor.o.zakharov@gmail.com"; Task4.Mailer.exe teacher@knu.ua LAB-1`
3. Open <http://localhost:8025> — the message `LAB-1` with the date, time, name and surname; `Task4.Mailer.exe` without arguments prints the usage

## What it does

Console program that sends an email whose text contains the current **date, time, first name and last name**. Two
arguments are required — the recipient address and the subject (the assignment uses `LAB-1`); without them the program
prints help.

![The message in Mailpit](docs/mailpit-message.png)

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

SMTP settings come **only from environment variables**, so no password ends up in the repository or in the
command line:

| Variable | Meaning | Default |
|---|---|---|
| `LAB1_SMTP_HOST` | server (`smtp.gmail.com`, or `localhost` for Mailpit) | — (required) |
| `LAB1_SMTP_PORT` | port | 587 (465 for `ssl`) |
| `LAB1_SMTP_SECURITY` | `auto` / `starttls` / `ssl` / `none` | `auto` |
| `LAB1_SMTP_USER`, `LAB1_SMTP_PASSWORD` | login (both or neither) | no login |
| `LAB1_SMTP_FROM` | sender address | `LAB1_SMTP_USER` |

Exit codes: `0` — sent, `1` — sending failed, `2` — missing/invalid arguments or settings.

## Try it locally with Mailpit (nothing leaves the PC)

[Mailpit](https://mailpit.axllent.org/) is an SMTP server in Docker that catches every message and shows it in a web UI.

```bash
# WSL
docker compose -f /mnt/c/Users/Ihor/projects/syssoft-labs/Lab1/Task4/compose.yaml up -d
```

```powershell
# PowerShell
$env:LAB1_SMTP_HOST = "localhost"; $env:LAB1_SMTP_PORT = "1025"; $env:LAB1_SMTP_SECURITY = "none"
$env:LAB1_SMTP_FROM = "ihor.o.zakharov@gmail.com"
dotnet run --project Lab1\Task4\Task4.Mailer -- teacher@knu.ua LAB-1
```

Open <http://localhost:8025> to see the message.

## Send for real through Gmail

1. Google account → Security → turn on **2-Step Verification**.
2. Create an **app password** at <https://myaccount.google.com/apppasswords> (Gmail rejects the normal password for
   SMTP).
3. Run the script — it asks for the Gmail address and the app password with hidden input and removes them afterwards:

```powershell
powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua
```

## Send from GitHub Actions (no password on the PC)

The workflow `.github/workflows/send-lab1-email.yml` runs this program on a GitHub runner:
**Actions → Send Lab1 email → Run workflow**, enter the recipient (subject defaults to `LAB-1`). It works only from
`main`. One-time setup — the password goes straight into GitHub's encrypted secrets and is masked in logs:

```powershell
gh variable set LAB1_SMTP_USER --body "<your gmail address>"
gh secret set LAB1_SMTP_PASSWORD        # asks for the app password with hidden input
```

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
the sender name and a text with the date, time, first and last name; settings come from the environment and the
password is never printed. One integration test sends a real message to Mailpit and checks it through Mailpit's API
(skipped when Mailpit is not running).
