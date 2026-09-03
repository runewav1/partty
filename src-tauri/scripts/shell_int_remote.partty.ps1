# ============================================================================
# Partty shell integration for PowerShell on remote SSH hosts (OSC 633 / OSC 7).
#
# Install (Windows remote): copy to the server and dot-source from your profile:
#   . C:\path\to\shell_int_remote.partty.ps1
# Typical profile path: $PROFILE  (e.g. ~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1)
#
# Works with Windows PowerShell 5.1+ and PowerShell 7+ (pwsh).
#
# Once loaded, set integration = true on the matching Partty SSH profile.
# ============================================================================

if ($Global:__ParttyState -and $Global:__ParttyState.Initialized) {
    return
}

$Global:__ParttyState = @{
    Initialized                   = $true
    OriginalPrompt                = $null
    LastHistoryId                 = -1
    IsInExecution                 = $false
    HasPSReadLine                 = $false
    OriginalPSConsoleHostReadLine = $null
    DebugMode                     = $env:PARTTY_DEBUG -eq "1"
}

function __Partty-Debug {
    param([string]$Message)
    if ($Global:__ParttyState.DebugMode) {
        [Console]::Error.WriteLine("[PARTTY-DEBUG] $Message")
    }
}

function __Partty-Escape-Value {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) {
        return ""
    }
    $result = [System.Text.StringBuilder]::new($Value.Length * 2)
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int]$ch
        # Escape control chars (0x00-0x1F), semicolon, backslash, and DEL.
        # Non-ASCII characters pass through verbatim as their original char.
        if ($code -lt 0x20 -or $code -eq 0x3B -or $code -eq 0x5C -or $code -eq 0x7F) {
            [void]$result.Append('\x{0:x2}' -f $code)
        }
        else {
            [void]$result.Append($ch)
        }
    }
    return $result.ToString()
}

function __Partty-UriEncode-Path {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return "" }
    $result = [System.Text.StringBuilder]::new($Path.Length * 2)
    foreach ($ch in $Path.ToCharArray()) {
        $code = [int]$ch
        if (($code -ge 0x41 -and $code -le 0x5A) -or
            ($code -ge 0x61 -and $code -le 0x7A) -or
            ($code -ge 0x30 -and $code -le 0x39) -or
            $code -eq 0x2D -or $code -eq 0x2E -or
            $code -eq 0x5F -or $code -eq 0x7E -or
            $code -eq 0x3A -or $code -eq 0x2F) {
            [void]$result.Append($ch)
        }
        else {
            [void]$result.Append('%{0:x2}' -f $code)
        }
    }
    return $result.ToString()
}

function __Partty-Path-To-FileUri {
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) {
        return ""
    }
    $normalizedPath = $Path.Replace('\', '/')
    $encoded = __Partty-UriEncode-Path $normalizedPath

    if ($encoded.StartsWith('//')) {
        return "file:" + $encoded
    }
    if ($encoded -match '^[A-Za-z]:') {
        return "file:///" + $encoded
    }
    return "file:///" + $encoded.TrimStart('/')
}

function __Partty-Get-SafeCwd {
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
        __Partty-Debug "Error getting CWD: $_"
        return $null
    }
}

function __Partty-Emit-OSC {
    param(
        [string]$Code,
        [string[]]$Params
    )
    $esc = [char]0x1b
    $bel = [char]0x07
    $payload = $Code
    if ($Params -and $Params.Count -gt 0) {
        $payload += ";" + ($Params -join ";")
    }
    [Console]::Write("${esc}]${payload}${bel}")
}

function __Partty-Emit-OSC-Batch {
    param([string[]]$Sequences)
    $esc = [char]0x1b
    $bel = [char]0x07
    $buffer = [System.Text.StringBuilder]::new()
    foreach ($seq in $Sequences) {
        [void]$buffer.Append("${esc}]${seq}${bel}")
    }
    [Console]::Write($buffer.ToString())
}

$Global:__ParttyState.OriginalPrompt = $function:Prompt

function Global:Prompt {
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

    if ($Global:__ParttyState.LastHistoryId -ne -1) {
        $wasExecuted = $Global:__ParttyState.IsInExecution -or (-not $Global:__ParttyState.HasPSReadLine)
        if ($wasExecuted) {
            $Global:__ParttyState.IsInExecution = $false
            if ($currentHistoryId -eq $Global:__ParttyState.LastHistoryId) {
                $sequences.Add("633;D")
            }
            else {
                $sequences.Add("633;D;$reportedExitCode")
            }
        }
    }

    $sequences.Add("633;A")

    $cwd = __Partty-Get-SafeCwd
    if ($cwd) {
        $cwdNormalized = $cwd.Replace('\', '/')
        $sequences.Add("633;P;Cwd=$(__Partty-Escape-Value $cwdNormalized)")
    }

    if ($sequences.Count -gt 0) {
        __Partty-Emit-OSC-Batch $sequences.ToArray()
    }

    if (-not $successState) {
        try { Write-Error "partty-internal" -ErrorAction SilentlyContinue 2>$null } catch {}
    }
    $global:LASTEXITCODE = $realExitCode

    $originalOutput = ""
    try {
        if ($Global:__ParttyState.OriginalPrompt) {
            $originalOutput = & $Global:__ParttyState.OriginalPrompt
        }
        else {
            $originalOutput = "PS $($executionContext.SessionState.Path.CurrentLocation)> "
        }
    }
    catch {
        __Partty-Debug "Original prompt error: $_"
        $originalOutput = "PS> "
    }

    $post = [System.Collections.Generic.List[string]]::new()
    if ($cwd) {
        $post.Add("7;$(__Partty-Path-To-FileUri $cwd)")
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

    $Global:__ParttyState.LastHistoryId = $currentHistoryId
    return $result
}

if (Get-Module -Name PSReadLine -ErrorAction SilentlyContinue) {
    $Global:__ParttyState.HasPSReadLine = $true
    $Global:__ParttyState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine

    function Global:PSConsoleHostReadLine {
        $commandLine = $Global:__ParttyState.OriginalPSConsoleHostReadLine.Invoke()
        $Global:__ParttyState.IsInExecution = $true
        if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
            __Partty-Emit-OSC "633" @("E", (__Partty-Escape-Value $commandLine))
        }
        __Partty-Emit-OSC "633" @("C")
        return $commandLine
    }
}

$isWindowsPlatform = $true
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $isWindowsPlatform = $IsWindows
}
__Partty-Emit-OSC "633" @("P", "IsWindows=$($isWindowsPlatform.ToString().ToLower())")

$initialCwd = __Partty-Get-SafeCwd
if ($initialCwd) {
    $initialCwdNormalized = $initialCwd.Replace('\', '/')
    __Partty-Emit-OSC "633" @("P", "Cwd=$(__Partty-Escape-Value $initialCwdNormalized)")
    __Partty-Emit-OSC "7" @("$(__Partty-Path-To-FileUri $initialCwd)")
}

$env:PARTTY_SHELL_INTEGRATION = "1"
if (-not $env:TERM_PROGRAM) {
    $env:TERM_PROGRAM = "Partty"
}
if (-not $env:TERM_PROGRAM_VERSION) {
    $env:TERM_PROGRAM_VERSION = "0.4.0"
}
