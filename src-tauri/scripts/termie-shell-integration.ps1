# ============================================================================
# Termie Shell Integration for PowerShell (pwsh 7+ / Windows PowerShell 5.1+)
# ============================================================================

# Guard: prevent double-sourcing
if ($Global:__TermieState -and $Global:__TermieState.Initialized) {
    return
}

$Global:__TermieState = @{
    Initialized         = $true
    OriginalPrompt      = $null
    LastHistoryId       = -1
    LastExitCode        = 0
    IsInExecution       = $false
    HasPSReadLine       = $false
    OriginalPSConsoleHostReadLine = $null
    SessionId           = [guid]::NewGuid().ToString("N").Substring(0, 8)
    DebugMode           = $env:TERMIE_DEBUG -eq "1"
}

function __Termie-Debug {
    param([string]$Message)
    if ($Global:__TermieState.DebugMode) {
        [Console]::Error.WriteLine("[TERMIE-DEBUG] $Message")
    }
}

function __Termie-Escape-Value {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) {
        return ""
    }
    $result = [System.Text.StringBuilder]::new($Value.Length * 2)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    foreach ($byte in $bytes) {
        # Escape control chars (0x00-0x1F), semicolon, backslash, and DEL
        if ($byte -lt 0x20 -or $byte -eq 0x3B -or $byte -eq 0x5C -or $byte -eq 0x7F) {
            [void]$result.Append('\x{0:x2}' -f $byte)
        }
        else {
            [void]$result.Append([char]$byte)
        }
    }
    return $result.ToString()
}

function __Termie-Path-To-FileUri {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) {
        return ""
    }
    $normalizedPath = $Path.Replace('\', '/')

    # UNC paths: \\server\share -> file://server/share
    if ($normalizedPath.StartsWith('//')) {
        return "file:" + $normalizedPath
    }
    # Drive letters: C:/path -> file:///C:/path
    if ($normalizedPath -match '^[A-Za-z]:') {
        return "file:///" + $normalizedPath
    }
    return "file:///" + $normalizedPath.TrimStart('/')
}

function __Termie-Get-SafeCwd {
    try {
        $location = Get-Location
        if ($location.Provider.Name -eq 'FileSystem') {
            $path = $location.ProviderPath
            if ($path) {
                $path = [System.IO.Path]::GetFullPath($path)
            }
            return $path
        }
        return $null
    }
    catch {
        __Termie-Debug "Error getting CWD: $_"
        return $null
    }
}

function __Termie-Emit-OSC {
    param(
        [string]$Code,
        [string[]]$Args
    )
    $esc = [char]0x1b
    $bel = [char]0x07
    $payload = $Code
    if ($Args -and $Args.Count -gt 0) {
        $payload += ";" + ($Args -join ";")
    }
    [Console]::Write("${esc}]${payload}${bel}")
}

function __Termie-Emit-OSC-Batch {
    param([string[]]$Sequences)
    $esc = [char]0x1b
    $bel = [char]0x07
    $buffer = [System.Text.StringBuilder]::new()
    foreach ($seq in $Sequences) {
        [void]$buffer.Append("${esc}]${seq}${bel}")
    }
    [Console]::Write($buffer.ToString())
}

$Global:__TermieState.OriginalPrompt = $function:Prompt

function Global:Prompt {
    # Capture exit state first
    $realExitCode = $LASTEXITCODE
    $successState = $?
    $reportedExitCode = if (-not $successState) {
        if ($realExitCode -and $realExitCode -ne 0) { $realExitCode } else { 1 }
    } else {
        if ($realExitCode) { $realExitCode } else { 0 }
    }

    Set-StrictMode -Off
    $sequences = [System.Collections.Generic.List[string]]::new()
    $lastHistory = Get-History -Count 1 -ErrorAction SilentlyContinue
    $currentHistoryId = if ($lastHistory) { $lastHistory.Id } else { -1 }

    # OSC 633;D - command finished
    if ($Global:__TermieState.LastHistoryId -ne -1) {
        $wasExecuted = $Global:__TermieState.IsInExecution -or (-not $Global:__TermieState.HasPSReadLine)
        if ($wasExecuted) {
            $Global:__TermieState.IsInExecution = $false
            if ($currentHistoryId -eq $Global:__TermieState.LastHistoryId) {
                $sequences.Add("633;D")
            }
            else {
                $sequences.Add("633;D;$reportedExitCode")
            }
        }
    }

    # OSC 633;A - prompt start
    $sequences.Add("633;A")

    # OSC 633;P;Cwd
    $cwd = __Termie-Get-SafeCwd
    if ($cwd) {
        $cwdNormalized = $cwd.Replace('\\', '/')
        $sequences.Add("633;P;Cwd=$(__Termie-Escape-Value $cwdNormalized)")
    }

    if ($sequences.Count -gt 0) {
        __Termie-Emit-OSC-Batch $sequences.ToArray()
    }

    # Restore $? / $LASTEXITCODE for original prompt
    if (-not $successState) {
        try { Write-Error "termie-internal" -ErrorAction SilentlyContinue 2>$null } catch {}
    }
    $global:LASTEXITCODE = $realExitCode

    # Run original prompt
    $originalOutput = ""
    try {
        if ($Global:__TermieState.OriginalPrompt) {
            $originalOutput = & $Global:__TermieState.OriginalPrompt
        }
        else {
            $originalOutput = "PS $($executionContext.SessionState.Path.CurrentLocation)> "
        }
    }
    catch {
        __Termie-Debug "Original prompt error: $_"
        $originalOutput = "PS> "
    }

    # Trailing sequences: OSC 7 + prompt end
    $post = [System.Collections.Generic.List[string]]::new()
    if ($cwd) {
        $post.Add("7;$(__Termie-Path-To-FileUri $cwd)")
    }
    $post.Add("633;B")
    $result = $originalOutput
    if ($post.Count -gt 0) {
        $esc = [char]0x1b
        $bel = [char]0x07
        foreach ($seq in $post) {
            $result += "${esc}]${seq}${bel}"
        }
    }

    $Global:__TermieState.LastHistoryId = $currentHistoryId
    $Global:__TermieState.LastExitCode = $reportedExitCode
    return $result
}

if (Get-Module -Name PSReadLine -ErrorAction SilentlyContinue) {
    $Global:__TermieState.HasPSReadLine = $true
    $Global:__TermieState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine

    __Termie-Emit-OSC "633" @("P", "HasRichCommandDetection=True")

    function Global:PSConsoleHostReadLine {
        $commandLine = $Global:__TermieState.OriginalPSConsoleHostReadLine.Invoke()
        $Global:__TermieState.IsInExecution = $true
        if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
            __Termie-Emit-OSC "633" @("E", (__Termie-Escape-Value $commandLine.Trim()))
        }
        __Termie-Emit-OSC "633" @("C")
        return $commandLine
    }
}

$isWindowsPlatform = $true
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $isWindowsPlatform = $IsWindows
}
__Termie-Emit-OSC "633" @("P", "IsWindows=$($isWindowsPlatform.ToString().ToLower())")
$shellType = if ($PSVersionTable.PSVersion.Major -ge 6) { "pwsh" } else { "powershell" }
__Termie-Emit-OSC "633" @("P", "ShellType=$shellType")
__Termie-Emit-OSC "633" @("P", "SessionId=$($Global:__TermieState.SessionId)")

# Emit initial CWD immediately
$initialCwd = __Termie-Get-SafeCwd
if ($initialCwd) {
    $initialCwdNormalized = $initialCwd.Replace('\\', '/')
    __Termie-Emit-OSC "633" @("P", "Cwd=$(__Termie-Escape-Value $initialCwdNormalized)")
    __Termie-Emit-OSC "7" @("$(__Termie-Path-To-FileUri $initialCwd)")
}

$env:TERMIE_SHELL_INTEGRATION = "1"
$env:TERM_PROGRAM = "termie"
$env:TERM_PROGRAM_VERSION = "1.0.0"
