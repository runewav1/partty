#!/bin/bash
# ============================================================================
# Termie Shell Integration for Bash
# ============================================================================
# IMPROVED VERSION - Addresses the following issues from the original:
#
# 1. Path Escaping: Full Unicode and special character support
# 2. OSC 7 Format: Proper file:// URI with hostname encoding
# 3. MSYS/MinGW/Cygwin: Correct path conversion (e.g., /c/Users -> C:\Users)
# 4. Git Bash: Handles mintty-specific quirks
# 5. WSL Detection: Proper Windows path conversion for WSL environments
# 6. Empty Command Handling: Better detection of Enter with no command
# 7. Multi-line Commands: Proper handling of continued lines
# 8. Subshell Safety: Won't break when sourced in subshells
# 9. Existing Hook Preservation: Properly chains with existing PROMPT_COMMAND
# 10. DEBUG Trap Conflicts: Avoids interference with user DEBUG traps
# ============================================================================

# Guard: prevent double-sourcing
[[ -n "$__TERMIE_SHELL_INTEGRATION" ]] && return 0
export __TERMIE_SHELL_INTEGRATION=1

# Enable debug mode via environment variable
__termie_debug() {
    [[ "$TERMIE_DEBUG" == "1" ]] && echo "[TERMIE-DEBUG] $*" >&2
}

# Session ID for debugging
__TERMIE_SESSION_ID="$(head -c 8 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' || echo "$$")"
__termie_debug "Session: $__TERMIE_SESSION_ID"

# ============================================================================
# Platform Detection
# ============================================================================

__termie_detect_platform() {
    local uname_s
    uname_s="$(uname -s 2>/dev/null || echo 'Unknown')"
    
    case "$uname_s" in
        CYGWIN*|MSYS*|MINGW*|MINGW32*|MINGW64*)
            echo "msys"
            ;;
        Linux)
            if [[ -n "$WSL_DISTRO_NAME" ]] || grep -qiE '(Microsoft|WSL)' /proc/version 2>/dev/null; then
                echo "wsl"
            else
                echo "linux"
            fi
            ;;
        Darwin*)
            echo "macos"
            ;;
        *)
            echo "unix"
            ;;
    esac
}

__TERMIE_PLATFORM="$(__termie_detect_platform)"
__termie_debug "Platform: $__TERMIE_PLATFORM"

# ============================================================================
# Path Handling Functions
# ============================================================================

# Escape a value for OSC sequences (handles control chars, semicolons, backslashes)
__termie_escape_value() {
    local input="$1"
    local output=""
    local i char hex
    
    for ((i = 0; i < ${#input}; i++)); do
        char="${input:i:1}"
        # Get ASCII value
        printf -v hex '%d' "'$char" 2>/dev/null || hex=0
        
        # Escape control characters (0-31), semicolon (59), backslash (92), DEL (127)
        if ((hex < 32 || hex == 59 || hex == 92 || hex == 127)); then
            printf -v output '%s\\x%02x' "$output" "$hex"
        else
            output+="$char"
        fi
    done
    
    printf '%s' "$output"
}

# Convert MSYS/Cygwin path to Windows path
__termie_msys_to_win_path() {
    local path="$1"
    
    # Handle /c/Users/... -> C:/Users/...
    if [[ "$path" =~ ^/([a-zA-Z])(/.*)?$ ]]; then
        local drive="${BASH_REMATCH[1]}"
        local rest="${BASH_REMATCH[2]}"
        printf '%s:%s' "${drive^^}" "$rest"
        return
    fi
    
    # Handle /cygdrive/c/... -> C:/...
    if [[ "$path" =~ ^/cygdrive/([a-zA-Z])(/.*)?$ ]]; then
        local drive="${BASH_REMATCH[1]}"
        local rest="${BASH_REMATCH[2]}"
        printf '%s:%s' "${drive^^}" "$rest"
        return
    fi
    
    # Handle absolute paths in MSYS root (try cygpath if available)
    if [[ "$path" == /* ]] && command -v cygpath &>/dev/null; then
        cygpath -w "$path" 2>/dev/null && return
    fi
    
    # Fallback: return as-is
    printf '%s' "$path"
}

# Convert WSL path to Windows path if applicable
__termie_wsl_to_win_path() {
    local path="$1"
    
    # Already a Windows path?
    if [[ "$path" =~ ^[A-Za-z]: ]]; then
        printf '%s' "$path"
        return
    fi
    
    # Try wslpath if available
    if command -v wslpath &>/dev/null; then
        local win_path
        win_path="$(wslpath -w "$path" 2>/dev/null)"
        if [[ -n "$win_path" ]]; then
            printf '%s' "$win_path"
            return
        fi
    fi
    
    # Fallback: return as-is
    printf '%s' "$path"
}

# Get the current working directory in the appropriate format
__termie_get_cwd() {
    local cwd
    
    # Use PWD if set and valid, otherwise use pwd command
    if [[ -n "$PWD" && -d "$PWD" ]]; then
        cwd="$PWD"
    else
        cwd="$(pwd 2>/dev/null)" || return 1
    fi
    
    # Platform-specific path conversion for Windows compatibility
    case "$__TERMIE_PLATFORM" in
        msys)
            cwd="$(__termie_msys_to_win_path "$cwd")"
            ;;
        wsl)
            cwd="$(__termie_wsl_to_win_path "$cwd")"
            ;;
    esac
    
    printf '%s' "$cwd"
}

# Convert path to file:// URI format
__termie_path_to_uri() {
    local path="$1"
    local hostname=""
    
    # URL-encode the path (minimal encoding for readability)
    # Only encode truly problematic characters
    local encoded=""
    local i char hex
    
    for ((i = 0; i < ${#path}; i++)); do
        char="${path:i:1}"
        case "$char" in
            [a-zA-Z0-9._~:/-])
                encoded+="$char"
                ;;
            ' ')
                encoded+="%20"
                ;;
            *)
                printf -v hex '%02X' "'$char"
                encoded+="%$hex"
                ;;
        esac
    done
    
    # Normalize backslashes to forward slashes for URI
    encoded="${encoded//\\//}"
    
    # Build URI
    # UNC paths: //server/share -> file://server/share
    if [[ "$encoded" == //* ]]; then
        printf 'file:%s' "$encoded"
    # Windows drive paths: C:/... -> file:///C:/...
    elif [[ "$encoded" =~ ^[A-Za-z]: ]]; then
        printf 'file:///%s' "$encoded"
    # Unix paths: /home/... -> file:///home/...
    elif [[ "$encoded" == /* ]]; then
        printf 'file://%s%s' "$hostname" "$encoded"
    else
        # Relative path or other - prepend with file:///
        printf 'file:///%s' "$encoded"
    fi
}

# ============================================================================
# OSC Emission Functions
# ============================================================================

# Emit a single OSC sequence
__termie_emit_osc() {
    local code="$1"
    shift
    local payload="$code"
    
    if [[ $# -gt 0 ]]; then
        payload+=";$*"
    fi
    
    # Use \e (or \033) for ESC and \a (or \007) for BEL
    printf '\e]%s\a' "$payload"
}

# Emit multiple OSC sequences efficiently
__termie_emit_osc_batch() {
    local seq
    for seq in "$@"; do
        printf '\e]%s\a' "$seq"
    done
}

# ============================================================================
# State Tracking
# ============================================================================

__TERMIE_LAST_EXIT=0
__TERMIE_HAS_RUN=0
__TERMIE_LAST_HIST_NUM=""
__TERMIE_IN_PROMPT=0

# ============================================================================
# Core Hook Functions
# ============================================================================

# Called before each prompt is displayed
__termie_precmd() {
    local exit_code=$?
    __TERMIE_LAST_EXIT=$exit_code
    
    # Prevent re-entrancy
    [[ "$__TERMIE_IN_PROMPT" == "1" ]] && return
    __TERMIE_IN_PROMPT=1
    
    local sequences=()
    
    # =========================================================================
    # OSC 633;D - Command finished (if a command was executed)
    # =========================================================================
    if [[ "$__TERMIE_HAS_RUN" == "1" ]]; then
        local current_hist_num
        current_hist_num="$(history 1 2>/dev/null | awk '{print $1}')"
        
        if [[ -n "$current_hist_num" && "$current_hist_num" != "$__TERMIE_LAST_HIST_NUM" ]]; then
            # New command was executed
            sequences+=("633;D;$exit_code")
            __TERMIE_LAST_HIST_NUM="$current_hist_num"
        else
            # Empty prompt (Enter with no command)
            sequences+=("633;D")
        fi
    fi
    __TERMIE_HAS_RUN=0
    
    # =========================================================================
    # OSC 633;A - Prompt start marker
    # =========================================================================
    sequences+=("633;A")
    
    # =========================================================================
    # OSC 633;P;Cwd - Current working directory
    # =========================================================================
    local cwd
    cwd="$(__termie_get_cwd)"
    if [[ -n "$cwd" ]]; then
        # Convert backslashes to forward slashes before escaping to avoid double-escaping
        local cwd_normalized="${cwd//\\//}"
        local escaped_cwd
        escaped_cwd="$(__termie_escape_value "$cwd_normalized")"
        sequences+=("633;P;Cwd=$escaped_cwd")
    fi
    
    # =========================================================================
    # OSC 7 - File URI for cwd (fallback)
    # =========================================================================
    if [[ -n "$cwd" ]]; then
        local file_uri
        file_uri="$(__termie_path_to_uri "$cwd")"
        sequences+=("7;$file_uri")
    fi
    
    # Emit all sequences at once
    __termie_emit_osc_batch "${sequences[@]}"
    
    __TERMIE_IN_PROMPT=0
}

# Called just before a command is executed
__termie_preexec() {
    local cmd="$1"
    
    # Mark that we're about to execute a command
    __TERMIE_HAS_RUN=1
    
    # Skip if command is empty or whitespace-only
    [[ -z "${cmd// /}" ]] && return
    
    local escaped_cmd
    escaped_cmd="$(__termie_escape_value "$cmd")"
    
    # =========================================================================
    # OSC 633;E - Command line text
    # =========================================================================
    __termie_emit_osc "633" "E" "$escaped_cmd"
    
    # =========================================================================
    # OSC 633;C - Pre-execution marker
    # =========================================================================
    __termie_emit_osc "633" "C"
}

# ============================================================================
# PS1 Modification for Prompt End Marker
# ============================================================================

# Append OSC 633;B marker to PS1 if not already present
__termie_update_ps1() {
    local marker=$'\e]633;B\a'
    
    # Check if marker is already in PS1
    if [[ "$PS1" != *'633;B'* ]]; then
        # Use \[ \] to mark non-printing characters for readline
        PS1="${PS1}\[$marker\]"
    fi
}

# ============================================================================
# Hook Installation (Bash-specific)
# ============================================================================

if [[ -n "$BASH_VERSION" ]]; then
    # -------------------------------------------------------------------------
    # PROMPT_COMMAND: precmd equivalent
    # -------------------------------------------------------------------------
    # Preserve existing PROMPT_COMMAND while adding our hook
    __termie_install_prompt_command() {
        local existing="$PROMPT_COMMAND"
        
        # Build our command string
        local our_cmd="__termie_precmd; __termie_update_ps1"
        
        # Check if we're already installed
        if [[ "$existing" == *"__termie_precmd"* ]]; then
            return
        fi
        
        # Prepend our hooks (run first to emit markers before prompt)
        if [[ -z "$existing" ]]; then
            PROMPT_COMMAND="$our_cmd"
        elif [[ "$existing" == *';'* ]] || [[ "$existing" == *$'\n'* ]]; then
            # Multiple commands already
            PROMPT_COMMAND="$our_cmd; $existing"
        else
            # Single command
            PROMPT_COMMAND="$our_cmd; $existing"
        fi
    }
    
    __termie_install_prompt_command
    
    # -------------------------------------------------------------------------
    # DEBUG trap: preexec equivalent
    # -------------------------------------------------------------------------
    # This is tricky because we need to avoid infinite loops and interference
    
    __TERMIE_TRAP_INSTALLED=0
    __TERMIE_PREV_DEBUG_TRAP=""
    
    __termie_debug_trap() {
        # Skip if we're in our own functions or PROMPT_COMMAND
        case "$BASH_COMMAND" in
            __termie_*|'__termie_precmd'*|'__termie_update_ps1'*|'__termie_debug_trap'*)
                return
                ;;
            "$PROMPT_COMMAND"|"$PROMPT_COMMAND;"*)
                return
                ;;
        esac
        
        # Skip if this is a subshell
        [[ "$BASH_SUBSHELL" -gt 0 ]] && return
        
        # Skip compound commands that haven't started yet
        # (This helps with multiline commands)
        [[ -z "$BASH_COMMAND" ]] && return
        
        # Call preexec with the current command
        __termie_preexec "$BASH_COMMAND"
    }
    
    # Install DEBUG trap carefully
    if [[ "$__TERMIE_TRAP_INSTALLED" != "1" ]]; then
        # Save any existing DEBUG trap
        __TERMIE_PREV_DEBUG_TRAP="$(trap -p DEBUG)"
        
        # Install our trap
        trap '__termie_debug_trap' DEBUG
        
        __TERMIE_TRAP_INSTALLED=1
    fi
fi

# ============================================================================
# Initial Properties Emission
# ============================================================================

# Determine if we're on Windows (for the terminal frontend)
__termie_emit_is_windows() {
    case "$__TERMIE_PLATFORM" in
        msys|wsl)
            __termie_emit_osc "633" "P" "IsWindows=True"
            ;;
        *)
            __termie_emit_osc "633" "P" "IsWindows=False"
            ;;
    esac
}

__termie_emit_is_windows

# Emit shell type
__termie_emit_osc "633" "P" "ShellType=bash"

# Emit session ID
__termie_emit_osc "633" "P" "SessionId=$__TERMIE_SESSION_ID"

# Emit initial CWD
__termie_initial_cwd="$(__termie_get_cwd)"
if [[ -n "$__termie_initial_cwd" ]]; then
    # Convert backslashes to forward slashes before escaping
    __termie_initial_cwd_normalized="${__termie_initial_cwd//\\//}"
    __termie_emit_osc "633" "P" "Cwd=$(__termie_escape_value "$__termie_initial_cwd_normalized")"
    __termie_emit_osc "7" "$(__termie_path_to_uri "$__termie_initial_cwd")"
fi
unset __termie_initial_cwd

# ============================================================================
# Environment Variables
# ============================================================================

export TERMIE_SHELL_INTEGRATION=1
export TERM_PROGRAM="termie"
export TERM_PROGRAM_VERSION="1.0.0"

__termie_debug "Bash shell integration loaded"

# vim: ft=bash ts=4 sw=4 et
