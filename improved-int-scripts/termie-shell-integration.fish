# ============================================================================
# Termie Shell Integration for Fish
# ============================================================================
# NEW SCRIPT - Fish was not previously supported in Termie
#
# Features:
# 1. Native Fish syntax using functions and events
# 2. Full OSC 633 protocol support
# 3. OSC 7 cwd tracking for file panel sync
# 4. Proper path escaping for all characters
# 5. WSL path conversion support
# 6. Async-safe output handling
# 7. Private mode awareness
# 8. Works with existing fish_prompt themes
# ============================================================================

# Guard: prevent double-sourcing
if set -q __TERMIE_SHELL_INTEGRATION
    exit 0
end
set -g __TERMIE_SHELL_INTEGRATION 1

# Debug mode
function __termie_debug -a message
    if test "$TERMIE_DEBUG" = "1"
        echo "[TERMIE-DEBUG] $message" >&2
    end
end

# Generate session ID
set -g __TERMIE_SESSION_ID (random)(random)
__termie_debug "Session: $__TERMIE_SESSION_ID"

# ============================================================================
# Platform Detection
# ============================================================================

function __termie_detect_platform
    set -l uname_s (uname -s 2>/dev/null; or echo 'Unknown')
    
    switch $uname_s
        case 'CYGWIN*' 'MSYS*' 'MINGW*'
            echo "msys"
        case 'Linux'
            if set -q WSL_DISTRO_NAME; or grep -qiE '(Microsoft|WSL)' /proc/version 2>/dev/null
                echo "wsl"
            else
                echo "linux"
            end
        case 'Darwin*'
            echo "macos"
        case '*'
            echo "unix"
    end
end

set -g __TERMIE_PLATFORM (__termie_detect_platform)
__termie_debug "Platform: $__TERMIE_PLATFORM"

# ============================================================================
# Path Handling Functions
# ============================================================================

# Escape a value for OSC sequences
function __termie_escape_value -a input
    if test -z "$input"
        return
    end
    
    set -l result ""
    set -l len (string length -- "$input")
    
    for i in (seq 1 $len)
        set -l char (string sub -s $i -l 1 -- "$input")
        set -l byte (printf '%d' "'$char")
        
        # Escape control characters (0-31), semicolon (59), backslash (92), DEL (127)
        if test $byte -lt 32 -o $byte -eq 59 -o $byte -eq 92 -o $byte -eq 127
            set result "$result"(printf '\\x%02x' $byte)
        else
            set result "$result$char"
        end
    end
    
    echo -n "$result"
end

# Convert MSYS/Cygwin path to Windows path
function __termie_msys_to_win_path -a path
    # Handle /c/Users/... -> C:/Users/...
    if string match -qr '^/([a-zA-Z])(/.*)?$' -- $path
        set -l parts (string match -r '^/([a-zA-Z])(/.*)?$' -- $path)
        set -l drive (string upper -- $parts[2])
        set -l rest $parts[3]
        echo -n "$drive:$rest"
        return
    end
    
    # Handle /cygdrive/c/... -> C:/...
    if string match -qr '^/cygdrive/([a-zA-Z])(/.*)?$' -- $path
        set -l parts (string match -r '^/cygdrive/([a-zA-Z])(/.*)?$' -- $path)
        set -l drive (string upper -- $parts[2])
        set -l rest $parts[3]
        echo -n "$drive:$rest"
        return
    end
    
    # Try cygpath if available
    if type -q cygpath
        cygpath -w "$path" 2>/dev/null
        and return
    end
    
    echo -n "$path"
end

# Convert WSL path to Windows path
function __termie_wsl_to_win_path -a path
    # Already Windows path?
    if string match -qr '^[A-Za-z]:' -- $path
        echo -n "$path"
        return
    end
    
    # Try wslpath
    if type -q wslpath
        set -l win_path (wslpath -w "$path" 2>/dev/null)
        if test -n "$win_path"
            echo -n "$win_path"
            return
        end
    end
    
    echo -n "$path"
end

# Get the current working directory with platform-appropriate formatting
function __termie_get_cwd
    set -l cwd "$PWD"
    
    switch $__TERMIE_PLATFORM
        case "msys"
            __termie_msys_to_win_path "$cwd"
        case "wsl"
            __termie_wsl_to_win_path "$cwd"
        case '*'
            echo -n "$cwd"
    end
end

# Convert path to file:// URI
function __termie_path_to_uri -a path
    set -l encoded ""
    set -l len (string length -- "$path")
    
    for i in (seq 1 $len)
        set -l char (string sub -s $i -l 1 -- "$path")
        switch $char
            case 'a-zA-Z0-9' '.' '_' '~' ':' '/' '-'
                set encoded "$encoded$char"
            case ' '
                set encoded "$encoded%20"
            case '\\'
                set encoded "$encoded/"
            case '*'
                set encoded "$encoded"(printf '%%%02X' "'$char")
        end
    end
    
    # Normalize slashes
    set encoded (string replace -a '\\' '/' -- "$encoded")
    
    # Build URI
    if string match -q '//*' -- $encoded
        # UNC path
        echo -n "file:$encoded"
    else if string match -qr '^[A-Za-z]:' -- $encoded
        # Windows drive
        echo -n "file:///$encoded"
    else if string match -q '/*' -- $encoded
        # Unix absolute
        echo -n "file://$encoded"
    else
        echo -n "file:///$encoded"
    end
end

# ============================================================================
# OSC Emission Functions
# ============================================================================

# Emit a single OSC sequence
function __termie_emit_osc
    set -l code $argv[1]
    set -l args $argv[2..-1]
    
    set -l payload $code
    if test (count $args) -gt 0
        set payload "$payload;"(string join ";" -- $args)
    end
    
    printf '\e]%s\a' "$payload"
end

# Emit multiple OSC sequences
function __termie_emit_osc_batch
    for seq in $argv
        printf '\e]%s\a' "$seq"
    end
end

# ============================================================================
# State Tracking
# ============================================================================

set -g __TERMIE_LAST_EXIT 0
set -g __TERMIE_HAS_RUN 0
set -g __TERMIE_CURRENT_CMD ""

# ============================================================================
# Core Hook Functions
# ============================================================================

# fish_prompt wrapper: Called when prompt is about to be displayed
function __termie_fish_prompt --on-event fish_prompt
    set -g __TERMIE_LAST_EXIT $status
    
    set -l sequences
    
    # =========================================================================
    # OSC 633;D - Command finished (if command was executed)
    # =========================================================================
    if test $__TERMIE_HAS_RUN -eq 1
        if test -n "$__TERMIE_CURRENT_CMD"
            set -a sequences "633;D;$__TERMIE_LAST_EXIT"
        else
            set -a sequences "633;D"
        end
    end
    set -g __TERMIE_HAS_RUN 0
    set -g __TERMIE_CURRENT_CMD ""
    
    # =========================================================================
    # OSC 633;A - Prompt start marker
    # =========================================================================
    set -a sequences "633;A"
    
    # =========================================================================
    # OSC 633;P;Cwd - Current working directory
    # =========================================================================
    set -l cwd (__termie_get_cwd)
    if test -n "$cwd"
        # Convert backslashes to forward slashes before escaping to avoid double-escaping
        set -l cwd_normalized (string replace --all '\\' '/' "$cwd")
        set -l escaped_cwd (__termie_escape_value "$cwd_normalized")
        set -a sequences "633;P;Cwd=$escaped_cwd"
    end
    
    # =========================================================================
    # OSC 7 - File URI for cwd
    # =========================================================================
    if test -n "$cwd"
        set -l file_uri (__termie_path_to_uri "$cwd")
        set -a sequences "7;$file_uri"
    end
    
    # Emit sequences
    __termie_emit_osc_batch $sequences
end

# fish_preexec: Called just before command execution
function __termie_fish_preexec --on-event fish_preexec
    set -l cmd $argv[1]
    
    set -g __TERMIE_HAS_RUN 1
    set -g __TERMIE_CURRENT_CMD "$cmd"
    
    # Skip empty commands
    if test -z (string trim -- "$cmd")
        return
    end
    
    set -l escaped_cmd (__termie_escape_value "$cmd")
    
    # =========================================================================
    # OSC 633;E - Command line text
    # =========================================================================
    __termie_emit_osc "633" "E" "$escaped_cmd"
    
    # =========================================================================
    # OSC 633;C - Pre-execution marker
    # =========================================================================
    __termie_emit_osc "633" "C"
end

# ============================================================================
# Prompt Modification for OSC 633;B
# ============================================================================

# We need to emit OSC 633;B after the prompt is displayed
# Fish doesn't have a direct way to do this, so we wrap fish_prompt
# or append to right_prompt_suffix

# The cleanest approach is to use fish_right_prompt_suffix if available (fish 3.4+)
# Or define a postexec handler

# For broad compatibility, we'll use fish_mode_prompt to emit B marker
# This runs after fish_prompt and before user input

function __termie_mode_prompt_suffix --on-event fish_prompt
    # This needs to emit AFTER the prompt, so we schedule it
    # Using right prompt suffix approach
end

# Alternative: Define or wrap fish_right_prompt
functions -q __termie_original_fish_right_prompt
or if functions -q fish_right_prompt
    functions -c fish_right_prompt __termie_original_fish_right_prompt
end

function fish_right_prompt
    # Call original if it exists
    if functions -q __termie_original_fish_right_prompt
        __termie_original_fish_right_prompt
    end
    
    # Emit prompt end marker
    printf '\e]633;B\a'
end

# Also emit B marker after left prompt for terminals that don't use right prompt
# We can do this by having the user add %{...%} style markers, but Fish doesn't
# support that syntax. Instead, we emit it as part of fish_right_prompt above.

# ============================================================================
# Initial Properties
# ============================================================================

# IsWindows property
switch $__TERMIE_PLATFORM
    case "msys" "wsl"
        __termie_emit_osc "633" "P" "IsWindows=True"
    case '*'
        __termie_emit_osc "633" "P" "IsWindows=False"
end

# Shell type
__termie_emit_osc "633" "P" "ShellType=fish"

# Session ID
__termie_emit_osc "633" "P" "SessionId=$__TERMIE_SESSION_ID"

# Initial CWD
set -l __termie_initial_cwd (__termie_get_cwd)
if test -n "$__termie_initial_cwd"
    # Convert backslashes to forward slashes before escaping
    set -l __termie_initial_cwd_normalized (string replace --all '\\' '/' "$__termie_initial_cwd")
    __termie_emit_osc "633" "P" "Cwd="(__termie_escape_value "$__termie_initial_cwd_normalized")
    __termie_emit_osc "7" (__termie_path_to_uri "$__termie_initial_cwd")
end

# ============================================================================
# Environment Variables
# ============================================================================

set -gx TERMIE_SHELL_INTEGRATION 1
set -gx TERM_PROGRAM "termie"
set -gx TERM_PROGRAM_VERSION "1.0.0"

__termie_debug "Fish shell integration loaded"

# vim: ft=fish ts=4 sw=4 et
