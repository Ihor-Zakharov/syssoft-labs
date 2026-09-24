<#
.SYNOPSIS
    sysprog - run, build and test the lab tasks by name: sysprog lab1 task1 flashrom

.DESCRIPTION
    Labs and tasks are discovered from the repository layout (Lab<N>\Task<M>\<Project>\*.csproj), nothing is
    hard-coded. Names are case-insensitive and may be bare numbers: "lab1", "Lab1" and "1" are the same lab.
    Run "sysprog help" for the commands. Works in Windows PowerShell 5.1 and PowerShell 7.
#>

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ScriptPath = $MyInvocation.MyCommand.Path
$Commands = @('help', 'list', 'build', 'test', 'open', 'readme', 'install', 'uninstall')
$BlockStart = '# >>> sysprog >>>'
$BlockEnd = '# <<< sysprog <<<'

function Get-Number([string]$Name, [string]$Prefix) {
    if ($Name -match "^(?i:$Prefix)?(\d+)$") { return [int]$Matches[1] }
    return $null
}

function Get-Labs {
    Get-ChildItem -LiteralPath $RepoRoot -Directory |
        Where-Object { $_.Name -match '^Lab\d+$' } |
        Sort-Object { [int]($_.Name -replace '\D', '') }
}

function Get-Tasks([System.IO.DirectoryInfo]$Lab) {
    Get-ChildItem -LiteralPath $Lab.FullName -Directory |
        Where-Object { $_.Name -match '^Task\d+$' } |
        Sort-Object { [int]($_.Name -replace '\D', '') }
}

function Fail([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 2
}

function Resolve-Lab([string]$Name) {
    $number = Get-Number $Name 'lab'
    $lab = Get-Labs | Where-Object { [int]($_.Name -replace '\D', '') -eq $number }
    if ($null -eq $number -or -not $lab) {
        Fail "Unknown lab '$Name'. Labs: $((Get-Labs | ForEach-Object Name) -join ', ')"
    }
    return $lab
}

function Resolve-Task([System.IO.DirectoryInfo]$Lab, [string]$Name) {
    $number = Get-Number $Name 'task'
    $task = Get-Tasks $Lab | Where-Object { [int]($_.Name -replace '\D', '') -eq $number }
    if ($null -eq $number -or -not $task) {
        Fail "Unknown task '$Name' in $($Lab.Name). Tasks: $((Get-Tasks $Lab | ForEach-Object Name) -join ', ')"
    }
    return $task
}

# The runnable project of a task: the *.csproj that is not a test project
function Get-TaskInfo([System.IO.DirectoryInfo]$Task) {
    $project = Get-ChildItem -LiteralPath $Task.FullName -Recurse -Depth 1 -Filter *.csproj |
        Where-Object { $_.BaseName -notmatch '\.Tests$' } | Select-Object -First 1
    $tests = Get-ChildItem -LiteralPath $Task.FullName -Recurse -Depth 1 -Filter *.csproj |
        Where-Object { $_.BaseName -match '\.Tests$' } | Select-Object -First 1
    $xml = if ($project) { Get-Content -LiteralPath $project.FullName -Raw } else { '' }
    $tfm = if ($xml -match '<TargetFramework>([^<]+)</TargetFramework>') { $Matches[1] } else { 'net10.0' }
    $readme = Join-Path $Task.FullName 'README.md'
    $description = ''
    if (Test-Path -LiteralPath $readme) {
        $title = Get-Content -LiteralPath $readme -Encoding UTF8 | Where-Object { $_ -match '^# ' } | Select-Object -First 1
        if ($title) { $description = ($title -replace '^#\s*', '') -replace '^Task\d+\s*\S\s*', '' }
    }
    [pscustomobject]@{
        Task        = $Task
        Project     = $project
        Tests       = $tests
        Type        = if ($xml -match '<UseWindowsForms>\s*true') { 'WinForms' } else { 'Console' }
        Exe         = if ($project) { Join-Path $project.DirectoryName "bin\Release\$tfm\$($project.BaseName).exe" } else { $null }
        Description = $description
    }
}

function Invoke-Dotnet([string[]]$Arguments) {
    & dotnet @Arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Build only when a source file is newer than the executable
function Update-Build($Info) {
    $exe = Get-Item -LiteralPath $Info.Exe -ErrorAction SilentlyContinue
    if ($exe) {
        $newer = Get-ChildItem -LiteralPath $Info.Project.DirectoryName -Recurse -File -Include *.cs, *.csproj, *.resx |
            Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' -and $_.LastWriteTime -gt $exe.LastWriteTime } |
            Select-Object -First 1
        if (-not $newer) { return }
    }
    Write-Host "Building $($Info.Project.BaseName)..." -ForegroundColor DarkGray
    Invoke-Dotnet @('build', $Info.Project.FullName, '-c', 'Release', '--nologo', '-v', 'q', '-clp:NoSummary')
}

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Show-Help {
    @"
sysprog - run the lab tasks by name

  sysprog <lab> <task> [args...]   build if needed and run, args passed as is (e.g. sysprog lab1 task1 flashrom)
  sysprog list                     all labs and tasks
  sysprog build [lab]              build all labs or one
  sysprog test [lab [task]]        run tests of all labs, one lab or one task
  sysprog open <lab>               open the lab solution in Visual Studio
  sysprog readme <lab> <task>      print the task README
  sysprog install | uninstall      add/remove the 'sysprog' command and tab completion in `$PROFILE

Names are case-insensitive and may be numbers: lab1 = Lab1 = 1, task2 = 2.
The program runs in the CURRENT folder (Task1 writes its files there).

"@
    Show-List
}

function Show-List {
    foreach ($lab in Get-Labs) {
        foreach ($task in Get-Tasks $lab) {
            $info = Get-TaskInfo $task
            '{0,-6} {1,-7} {2,-24} {3,-9} {4}' -f $lab.Name.ToLower(), $task.Name.ToLower(), $info.Project.BaseName, $info.Type, $info.Description
        }
    }
}

function Get-ProfilePath {
    if ($env:SYSPROG_PROFILE) { return $env:SYSPROG_PROFILE }
    return $PROFILE
}

function Remove-Block([string]$Text) {
    $pattern = '(?s)\r?\n?' + [regex]::Escape($BlockStart) + '.*?' + [regex]::Escape($BlockEnd) + '\r?\n?'
    return [regex]::Replace($Text, $pattern, "`r`n").TrimEnd() + "`r`n"
}

function Install-Profile {
    $path = Get-ProfilePath
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $text = if (Test-Path -LiteralPath $path) { Remove-Block (Get-Content -LiteralPath $path -Raw) } else { '' }
    $block = @"
$BlockStart
function sysprog { & '$ScriptPath' @args }
Register-ArgumentCompleter -Native -CommandName sysprog -ScriptBlock {
    param(`$word, `$ast, `$cursor)
    `$done = @(`$ast.CommandElements | Select-Object -Skip 1 | ForEach-Object { `$_.Extent.Text })
    if (`$word) { `$done = @(`$done | Select-Object -SkipLast 1) }
    & '$ScriptPath' __complete @done | Where-Object { `$_ -like "`$word*" } |
        ForEach-Object { [System.Management.Automation.CompletionResult]::new(`$_, `$_, 'ParameterValue', `$_) }
}
$BlockEnd
"@
    Set-Content -LiteralPath $path -Value ($text.TrimEnd() + "`r`n`r`n" + $block + "`r`n") -Encoding UTF8
    Write-Host "Added sysprog to $path. Open a new PowerShell window (or run: . `$PROFILE)."
}

function Uninstall-Profile {
    $path = Get-ProfilePath
    if (Test-Path -LiteralPath $path) {
        Set-Content -LiteralPath $path -Value (Remove-Block (Get-Content -LiteralPath $path -Raw)) -Encoding UTF8
    }
    Write-Host "Removed sysprog from $path."
}

# Candidates for tab completion, given the words already typed after "sysprog"
function Get-Completions([string[]]$Done) {
    $labs = @(Get-Labs | ForEach-Object { $_.Name.ToLower() })
    if ($Done.Count -eq 0) { return $Commands + $labs }
    $first = $Done[0].ToLower()
    if ($Done.Count -eq 1) {
        if ($first -in 'build', 'test', 'open', 'readme') { return $labs }
        if ($null -ne (Get-Number $first 'lab')) { return @(Get-Tasks (Resolve-Lab $first) | ForEach-Object { $_.Name.ToLower() }) }
    }
    if ($Done.Count -eq 2 -and $first -in 'test', 'readme') {
        return @(Get-Tasks (Resolve-Lab $Done[1]) | ForEach-Object { $_.Name.ToLower() })
    }
    return @()
}

# ---------------------------------------------------------------------------------------------------------------

$argv = @($args)
$command = if ($argv.Count -gt 0) { [string]$argv[0] } else { 'help' }

switch ($command.ToLower()) {
    'help' { Show-Help; exit 0 }
    '-h' { Show-Help; exit 0 }
    '--help' { Show-Help; exit 0 }
    'list' { Show-List; exit 0 }
    '__complete' { Get-Completions @($argv | Select-Object -Skip 1); exit 0 }
    'install' { Install-Profile; exit 0 }
    'uninstall' { Uninstall-Profile; exit 0 }
    'build' {
        $labs = if ($argv.Count -gt 1) { @(Resolve-Lab $argv[1]) } else { @(Get-Labs) }
        foreach ($lab in $labs) { Invoke-Dotnet @('build', (Join-Path $lab.FullName "$($lab.Name).slnx"), '-c', 'Release', '--nologo') }
        exit 0
    }
    'test' {
        if ($argv.Count -gt 2) {
            $info = Get-TaskInfo (Resolve-Task (Resolve-Lab $argv[1]) $argv[2])
            if (-not $info.Tests) { Fail "No test project in $($info.Task.FullName)" }
            Invoke-Dotnet @('test', $info.Tests.FullName, '--nologo')
        }
        else {
            $labs = if ($argv.Count -gt 1) { @(Resolve-Lab $argv[1]) } else { @(Get-Labs) }
            foreach ($lab in $labs) { Invoke-Dotnet @('test', (Join-Path $lab.FullName "$($lab.Name).slnx"), '--nologo') }
        }
        exit 0
    }
    'open' {
        if ($argv.Count -lt 2) { Fail 'Usage: sysprog open <lab>' }
        $lab = Resolve-Lab $argv[1]
        Invoke-Item -LiteralPath (Join-Path $lab.FullName "$($lab.Name).slnx")
        exit 0
    }
    'readme' {
        if ($argv.Count -lt 3) { Fail 'Usage: sysprog readme <lab> <task>' }
        Get-Content -LiteralPath (Join-Path (Resolve-Task (Resolve-Lab $argv[1]) $argv[2]).FullName 'README.md') -Encoding UTF8
        exit 0
    }
    default {
        if ($argv.Count -lt 2) { Fail "Usage: sysprog <lab> <task> [args...]  (sysprog help)" }
        $info = Get-TaskInfo (Resolve-Task (Resolve-Lab $argv[0]) $argv[1])
        if (-not $info.Project) { Fail "No runnable project in $($info.Task.FullName)" }
        Update-Build $info
        if ($info.Task.Name -eq 'Task3' -and -not (Test-Elevated)) {
            Write-Host 'Hint: writing HKLM (Create P6) needs an administrator PowerShell.' -ForegroundColor Yellow
        }
        $rest = @($argv | Select-Object -Skip 2)
        & $info.Exe @rest
        exit $LASTEXITCODE
    }
}
