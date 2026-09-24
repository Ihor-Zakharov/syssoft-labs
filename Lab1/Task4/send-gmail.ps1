<#
.SYNOPSIS
    Sends the Lab 1 message to a real mailbox through Gmail.

.DESCRIPTION
    Asks for the Gmail address (unless -From is given) and an app password (hidden input). The password lives only
    in this PowerShell process and its child: it is never written to disk, to the user's environment variables or to
    the history. Gmail needs an APP PASSWORD (Google account -> Security -> 2-Step Verification must be on ->
    https://myaccount.google.com/apppasswords), not the account password.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua
    powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua -From me@gmail.com -Subject LAB-1
#>
param(
    [Parameter(Mandatory = $true)][string]$To,
    [string]$Subject = "LAB-1",
    [string]$From
)

$ErrorActionPreference = "Stop"

if (-not $From) { $From = Read-Host "Your Gmail address" }
$secure = Read-Host "Gmail app password (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

# Gmail is the program's default server: settings left over from a Mailpit test must not redirect the message
foreach ($name in "LAB1_SMTP_HOST", "LAB1_SMTP_PORT", "LAB1_SMTP_SECURITY", "LAB1_SMTP_FROM") {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

try {
    $env:LAB1_SMTP_USER = $From
    $env:LAB1_SMTP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

    dotnet run --project (Join-Path $PSScriptRoot "Task4.Mailer") -c Release -- $To $Subject
    $exitCode = $LASTEXITCODE
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:LAB1_SMTP_USER, Env:LAB1_SMTP_PASSWORD -ErrorAction SilentlyContinue
}

exit $exitCode
