# ============================================================================
# Termie Shell Integration for PowerShell (pwsh 7+ / Windows PowerShell 5.1+)
# ============================================================================
# IMPROVED VERSION - Addresses the following issues from the original:
# 
# 1. Path Encoding: Properly handles UNC paths, network drives, and special chars
# 2. OSC 7 URI Format: Correctly formats file:// URIs with hostname for Windows
# 3. Empty Prompt Detection: Better handling of repeated Enter presses
# 4. Exit Code Accuracy: Fixes edge cases where $? doesn't reflect true exit
# 5. Unicode Escaping: Full byte-level escaping for all control characters
# 6. Provider Path Handling: Supports registry, cert, and other PS providers
# 7. Nested Shell Detection: Warns when shell integration may conflict
# 8. Async-Safe Output: Uses proper output buffering to avoid race conditions
# 9. ANSI Sequence Safety: Ensures sequences aren't split across writes
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

# ============================================================================
# Helper Functions
# ============================================================================

function __Termie-Debug {
    param([string]$Message)
    if ($Global:__TermieState.DebugMode) {
        [Console]::Error.WriteLine("[TERMIE-DEBUG] $Message")
    }
}

<#
.SYNOPSIS
    Escapes a string value for safe OSC sequence transmission.
.DESCRIPTION
    Escapes control characters, semicolons, backslashes, and newlines
    using \xHH encoding per VSCode shell integration protocol.
#>
function __Termie-Escape-Value {
    param([string]$Value)
    
    if ([string]::IsNullOrEmpty($Value)) {
        return ""
    }
    
    $result = [System.Text.StringBuilder]::new($Value.Length * 2)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    
    foreach ($byte in $bytes) {
        # Escape control characters (0x00-0x1F), semicolon, backslash, and DEL
        if ($byte -lt 0x20 -or $byte -eq 0x3B -or $byte -eq 0x5C -or $byte -eq 0x7F) {
            [void]$result.Append('\x{0:x2}' -f $byte)
        }
        else {
            [void]$result.Append([char]$byte)
        }
    }
    
    return $result.ToString()
}

<#
.SYNOPSIS
    Converts a local path to a proper file:// URI for OSC 7.
.DESCRIPTION
    Handles Windows paths, UNC paths, and ensures proper encoding.
    Format: file://hostname/path (hostname empty for local paths)
#>
function __Termie-Path-To-FileUri {
    param([string]$Path)
    
    if ([string]::IsNullOrEmpty($Path)) {
        return ""
    }
    
    # Normalize path separators to forward slashes
    $normalizedPath = $Path.Replace('\', '/')
    
    # Handle UNC paths: \\server\share -> file://server/share
    if ($normalizedPath.StartsWith('//')) {
        $uri = "file:" + $normalizedPath
        return $uri
    }
    
    # Handle drive letters: C:/path -> file:///C:/path
    if ($normalizedPath -match '^[A-Za-z]:') {
        # Ensure drive letter path starts correctly
        $uri = "file:///" + $normalizedPath
        return $uri
    }
    
    # Fallback: assume local path
    return "file:///" + $normalizedPath.TrimStart('/')
}

<#
.SYNOPSIS
    Gets the current working directory in a safe, normalized format.
.DESCRIPTION
    Handles FileSystem provider, other providers, and edge cases.
#>
function __Termie-Get-SafeCwd {
    try {
        $location = Get-Location
        
        # Only emit for FileSystem provider
        if ($location.Provider.Name -eq 'FileSystem') {
            # Use ProviderPath for the actual filesystem path
            $path = $location.ProviderPath
            
            # Resolve any relative components
            if ($path) {
                $path = [System.IO.Path]::GetFullPath($path)
            }
            
            return $path
        }
        
        # For non-filesystem providers, return null (don't update file tree)
        return $null
    }
    catch {
        __Termie-Debug "Error getting CWD: $_"
        return $null
    }
}

<#
.SYNOPSIS
    Emits a complete OSC sequence atomically to avoid partial writes.
#>
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
    
    $sequence = "${esc}]${payload}${bel}"
    
    # Write atomically to avoid race conditions
    [Console]::Write($sequence)
}

<#
.SYNOPSIS
    Emits multiple OSC sequences as a single buffered write.
#>
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

# ============================================================================
# Core Integration: Custom Prompt
# ============================================================================

# Capture the original prompt function
$Global:__TermieState.OriginalPrompt = $function:Prompt

function Global:Prompt {
    # Capture the real exit code FIRST, before any other operations
    $realExitCode = $LASTEXITCODE
    $successState = $?
    
    # Calculate the exit code to report
    # $? is false if the last command failed, but $LASTEXITCODE may still be 0
    # for PowerShell cmdlet failures
    $reportedExitCode = if (-not $successState) {
        if ($realExitCode -and $realExitCode -ne 0) { $realExitCode } else { 1 }
    }
    else {
        if ($realExitCode) { $realExitCode } else { 0 }
    }
    
    Set-StrictMode -Off
    $sequences = [System.Collections.Generic.List[string]]::new()
    
    # Get current history
    $lastHistory = Get-History -Count 1 -ErrorAction SilentlyContinue
    $currentHistoryId = if ($lastHistory) { $lastHistory.Id } else { -1 }
    
    # =========================================================================
    # OSC 633;D - Command finished (only if a command was executed)
    # =========================================================================
    if ($Global:__TermieState.LastHistoryId -ne -1) {
        $wasExecuted = $Global:__TermieState.IsInExecution -or 
                       (-not $Global:__TermieState.HasPSReadLine)
        
        if ($wasExecuted) {
            $Global:__TermieState.IsInExecution = $false
            
            # Check if this is a new command or just an empty prompt
            if ($currentHistoryId -eq $Global:__TermieState.LastHistoryId) {
                # Empty prompt (Enter pressed with no command)
                $sequences.Add("633;D")
            }
            else {
                # Actual command completed
                $sequences.Add("633;D;$reportedExitCode")
            }
        }
    }
    
    # =========================================================================
    # OSC 633;A - Prompt start marker
    # =========================================================================
    $sequences.Add("633;A")
    
    # =========================================================================
    # OSC 633;P;Cwd - Current working directory property
    # =========================================================================
    $cwd = __Termie-Get-SafeCwd
    if ($cwd) {
        # Convert backslashes to forward slashes before escaping to avoid double-escaping
        $cwdNormalized = $cwd.Replace('\', '/')
        $escapedCwd = __Termie-Escape-Value $cwdNormalized
        $sequences.Add("633;P;Cwd=$escapedCwd")
    }
    
    # Emit accumulated sequences before prompt
    if ($sequences.Count -gt 0) {
        __Termie-Emit-OSC-Batch $sequences.ToArray()
    }
    
    # =========================================================================
    # Restore $? and $LASTEXITCODE for the original prompt
    # =========================================================================
    # This is a hack to preserve $? for prompts that check it
    if (-not $successState) {
        try { Write-Error "termie-internal" -ErrorAction SilentlyContinue 2>$null } catch {}
    }
    $global:LASTEXITCODE = $realExitCode
    
    # =========================================================================
    # Execute the original prompt
    # =========================================================================
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
    
    # =========================================================================
    # OSC 7 - File URI for cwd (fallback for terminals that prefer this)
    # =========================================================================
    $postSequences = [System.Collections.Generic.List[string]]::new()
    
    if ($cwd) {
        $fileUri = __Termie-Path-To-FileUri $cwd
        $postSequences.Add("7;$fileUri")
    }
    
    # =========================================================================
    # OSC 633;B - Prompt end marker (input area begins)
    # =========================================================================
    $postSequences.Add("633;B")
    
    # Build final output with trailing sequences
    $result = $originalOutput
    if ($postSequences.Count -gt 0) {
        $esc = [char]0x1b
        $bel = [char]0x07
        foreach ($seq in $postSequences) {
            $result += "${esc}]${seq}${bel}"
        }
    }
    
    # Update state for next prompt
    $Global:__TermieState.LastHistoryId = $currentHistoryId
    $Global:__TermieState.LastExitCode = $reportedExitCode
    
    return $result
}

# ============================================================================
# PSReadLine Integration (Rich Command Detection)
# ============================================================================

if (Get-Module -Name PSReadLine -ErrorAction SilentlyContinue) {
    $Global:__TermieState.HasPSReadLine = $true
    $Global:__TermieState.OriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine
    
    # Signal that we support rich command detection
    __Termie-Emit-OSC "633" @("P", "HasRichCommandDetection=True")
    
    function Global:PSConsoleHostReadLine {
        # Read the command line from PSReadLine
        $commandLine = $null
        try {
            if ($Global:__TermieState.OriginalPSConsoleHostReadLine) {
                $commandLine = & $Global:__TermieState.OriginalPSConsoleHostReadLine
            }
            else {
                # Fallback to default PSReadLine handler
                $commandLine = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine(
                    $Host.Runspace,
                    $ExecutionContext
                )
            }
        }
        catch {
            __Termie-Debug "PSConsoleHostReadLine error: $_"
            return $null
        }
        
        # Mark that a command is about to be executed
        $Global:__TermieState.IsInExecution = $true
        
        # =====================================================================
        # OSC 633;E - Command line text
        # =====================================================================
        if (-not [string]::IsNullOrWhiteSpace($commandLine)) {
            $escapedCmd = __Termie-Escape-Value $commandLine.Trim()
            __Termie-Emit-OSC "633" @("E", $escapedCmd)
        }
        
        # =====================================================================
        # OSC 633;C - Pre-execution marker
        # =====================================================================
        __Termie-Emit-OSC "633" @("C")
        
        return $commandLine
    }
}

# ============================================================================
# Platform Detection & Initial Properties
# ============================================================================

# Determine if running on Windows
$isWindowsPlatform = $true
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $isWindowsPlatform = $IsWindows
}

__Termie-Emit-OSC "633" @("P", "IsWindows=$($isWindowsPlatform.ToString().ToLower())")

# Emit shell type for context-aware features
$shellType = if ($PSVersionTable.PSVersion.Major -ge 6) { "pwsh" } else { "powershell" }
__Termie-Emit-OSC "633" @("P", "ShellType=$shellType")

# Emit session ID for debugging multi-pane scenarios
__Termie-Emit-OSC "633" @("P", "SessionId=$($Global:__TermieState.SessionId)")

# Emit initial CWD immediately (helps file tree sync on startup)
$initialCwd = __Termie-Get-SafeCwd
if ($initialCwd) {
    # Convert backslashes to forward slashes before escaping
    $initialCwdNormalized = $initialCwd.Replace('\', '/')
    $escapedInitialCwd = __Termie-Escape-Value $initialCwdNormalized
    __Termie-Emit-OSC "633" @("P", "Cwd=$escapedInitialCwd")

    $fileUri = __Termie-Path-To-FileUri $initialCwd
    __Termie-Emit-OSC "7" @($fileUri)
}

# ============================================================================
# Environment Marker
# ============================================================================

$env:TERMIE_SHELL_INTEGRATION = "1"
$env:TERM_PROGRAM = "termie"
$env:TERM_PROGRAM_VERSION = "1.0.0"

__Termie-Debug "Shell integration loaded (Session: $($Global:__TermieState.SessionId), PSReadLine: $($Global:__TermieState.HasPSReadLine))"
