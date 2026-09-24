<#
.SYNOPSIS
    Sends the Lab 1 message through Gmail.

.DESCRIPTION
    Asks for the Gmail address and an app password (hidden input). The password lives only in this PowerShell
    process and its child: it is never written to disk, to the user's environment variables or to the history.
    Gmail needs an APP PASSWORD (Google account -> Security -> 2-Step Verification must be on ->
    https://myaccount.google.com/apppasswords), not the account password.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua
    powershell -ExecutionPolicy Bypass -File Lab1\Task4\send-gmail.ps1 -To teacher@knu.ua -Subject LAB-1
#>
param(
    [Parameter(Mandatory = $true)][string]$To,
    [string]$Subject = "LAB-1"
)

$ErrorActionPreference = "Stop"

$gmail = Read-Host "Your Gmail address"
$secure = Read-Host "Gmail app password (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$variables = "LAB1_SMTP_HOST", "LAB1_SMTP_PORT", "LAB1_SMTP_SECURITY", "LAB1_SMTP_USER", "LAB1_SMTP_PASSWORD", "LAB1_SMTP_FROM"

try {
    $env:LAB1_SMTP_HOST = "smtp.gmail.com"
    $env:LAB1_SMTP_PORT = "587"
    $env:LAB1_SMTP_SECURITY = "starttls"
    $env:LAB1_SMTP_USER = $gmail
    $env:LAB1_SMTP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

    dotnet run --project (Join-Path $PSScriptRoot "Task4.Mailer") -c Release -- $To $Subject
    $exitCode = $LASTEXITCODE
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    foreach ($name in $variables) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}

exit $exitCode
