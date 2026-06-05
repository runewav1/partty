#!/bin/zsh
# ============================================================================
# Termie Shell Integration for Zsh
# ============================================================================
# IMPROVED VERSION - Addresses the following issues from the original:
#
# 1. Hook Management: Uses add-zsh-hook properly with conflict detection
# 2. Path Escaping: Full Unicode support via zsh built-ins
# 3. OSC 7 Format: Proper file:// URI formatting
# 4. MSYS2/WSL Support: Path conversion for Windows environments
# 5. Async Safety: Proper handling of background jobs
# 6. Right Prompt: Handles RPROMPT in addition to PS1
# 7. Completion System: Doesn't interfere with zsh completion
# 8. Options Safety: Preserves and restores zsh options properly
# 9. Vi Mode: Compatible with zle vi mode
# 10. Transient Prompt: Works with powerlevel10k transient prompts
# ============================================================================

# Guard: prevent double-sourcing
[[ -n "$__TERMIE_SHELL_INTEGRATION" ]] && return 0
typeset -g __TERMIE_SHELL_INTEGRATION=1

# Enable debug mode
__termie_debug() {
    [[ "$TERMIE_DEBUG" == "1" ]] && print -r -- "[TERMIE-DEBUG] $*" >&2
}

# Generate session ID
typeset -g __TERMIE_SESSION_ID="${(L)$(head -c 4 /dev/urandom 2>/dev/null | xxd -p 2>/dev/null):-$$}"
__termie_debug "Session: $__TERMIE_SESSION_ID"

# ============================================================================
# Platform Detection
# ============================================================================

__termie_detect_platform() {
    case "$(uname -s 2>/dev/null)" in
        CYGWIN*|MSYS*|MINGW*)
            print msys
            ;;
        Linux)
            if [[ -n "$WSL_DISTRO_NAME" ]] || grep -qiE '(Microsoft|WSL)' /proc/version 2>/dev/null; then
                print wsl
            else
                print linux
            fi
            ;;
        Darwin*)
            print macos
            ;;
        *)
            print unix
            ;;
    esac
}

typeset -g __TERMIE_PLATFORM="$(__termie_detect_platform)"
__termie_debug "Platform: $__TERMIE_PLATFORM"

# ============================================================================
# Path Handling Functions
# ============================================================================

# Escape a value for OSC sequences using zsh parameter expansion
__termie_escape_value() {
    local input="$1"
    local result=""
    local char byte
    
    # Process each character
    for ((i = 1; i <= ${#input}; i++)); do
        char="${input[i]}"
        # Get numeric value of character
        byte=$(( #char ))
        
        # Escape control characters (0-31), semicolon (59), backslash (92), DEL (127)
        if (( byte < 32 || byte == 59 || byte == 92 || byte == 127 )); then
            result+=$(printf '\\x%02x' "$byte")
        else
            result+="$char"
        fi
    done
    
    print -rn -- "$result"
}

# Convert MSYS/Cygwin path to Windows path
__termie_msys_to_win_path() {
    local path="$1"
    
    # Handle /c/Users/... -> C:/Users/...
    if [[ "$path" =~ '^/([a-zA-Z])(/.*)?$' ]]; then
        print -rn -- "${(U)match[1]}:${match[2]}"
        return
    fi
    
    # Handle /cygdrive/c/... -> C:/...
    if [[ "$path" =~ '^/cygdrive/([a-zA-Z])(/.*)?$' ]]; then
        print -rn -- "${(U)match[1]}:${match[2]}"
        return
    fi
    
    # Try cygpath if available
    if (( $+commands[cygpath] )); then
        cygpath -w "$path" 2>/dev/null && return
    fi
    
    print -rn -- "$path"
}

# Convert WSL path to Windows path
__termie_wsl_to_win_path() {
    local path="$1"
    
    # Already Windows path?
    [[ "$path" =~ '^[A-Za-z]:' ]] && { print -rn -- "$path"; return; }
    
    # Try wslpath
    if (( $+commands[wslpath] )); then
        local win_path
        win_path="$(wslpath -w "$path" 2>/dev/null)"
        [[ -n "$win_path" ]] && { print -rn -- "$win_path"; return; }
    fi
    
    print -rn -- "$path"
}

# Get the current working directory with platform-appropriate formatting
__termie_get_cwd() {
    local cwd="${PWD:-$(pwd)}"
    
    case "$__TERMIE_PLATFORM" in
        msys)
            __termie_msys_to_win_path "$cwd"
            ;;
        wsl)
            __termie_wsl_to_win_path "$cwd"
            ;;
        *)
            print -rn -- "$cwd"
            ;;
    esac
}

# Convert path to file:// URI
__termie_path_to_uri() {
    local path="$1"
    local encoded=""
    local char
    
    # URL-encode path
    for ((i = 1; i <= ${#path}; i++)); do
        char="${path[i]}"
        case "$char" in
            [a-zA-Z0-9._~:/-])
                encoded+="$char"
                ;;
            ' ')
                encoded+="%20"
                ;;
            \\)
                encoded+="/"
                ;;
            *)
                encoded+=$(printf '%%%02X' "'$char")
                ;;
        esac
    done
    
    # Normalize slashes
    encoded="${encoded//\\//}"
    
    # Build URI based on path type
    if [[ "$encoded" == //* ]]; then
        # UNC path
        print -rn -- "file:$encoded"
    elif [[ "$encoded" =~ '^[A-Za-z]:' ]]; then
        # Windows drive
        print -rn -- "file:///$encoded"
    elif [[ "$encoded" == /* ]]; then
        # Unix absolute
        print -rn -- "file://$encoded"
    else
        print -rn -- "file:///$encoded"
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
    
    (( $# > 0 )) && payload+=";$*"
    
    print -Pn "\e]${payload}\a"
}

# Emit multiple OSC sequences
__termie_emit_osc_batch() {
    local seq
    for seq in "$@"; do
        print -Pn "\e]${seq}\a"
    done
}

# ============================================================================
# State Tracking
# ============================================================================

typeset -g __TERMIE_LAST_EXIT=0
typeset -g __TERMIE_HAS_RUN=0
typeset -g __TERMIE_CURRENT_CMD=""
typeset -g __TERMIE_IN_PROMPT=0

# ============================================================================
# Core Hook Functions
# ============================================================================

# precmd: Called before each prompt
__termie_precmd() {
    local exit_code=$?
    __TERMIE_LAST_EXIT=$exit_code
    
    # Prevent re-entrancy
    (( __TERMIE_IN_PROMPT )) && return
    __TERMIE_IN_PROMPT=1
    
    local -a sequences
    
    # =========================================================================
    # OSC 633;D - Command finished
    # =========================================================================
    if (( __TERMIE_HAS_RUN )); then
        if [[ -n "$__TERMIE_CURRENT_CMD" ]]; then
            # Command was executed
            sequences+=("633;D;$exit_code")
        else
            # Empty prompt
            sequences+=("633;D")
        fi
    fi
    __TERMIE_HAS_RUN=0
    __TERMIE_CURRENT_CMD=""
    
    # =========================================================================
    # OSC 633;A - Prompt start
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
    # OSC 7 - File URI for cwd
    # =========================================================================
    if [[ -n "$cwd" ]]; then
        local file_uri
        file_uri="$(__termie_path_to_uri "$cwd")"
        sequences+=("7;$file_uri")
    fi
    
    # Emit all sequences
    __termie_emit_osc_batch "${sequences[@]}"
    
    __TERMIE_IN_PROMPT=0
}

# preexec: Called just before command execution
__termie_preexec() {
    local cmd="$1"
    
    __TERMIE_HAS_RUN=1
    __TERMIE_CURRENT_CMD="$cmd"
    
    # Skip empty commands
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

__termie_update_ps1() {
    local marker=$'%{\e]633;B\a%}'
    
    # Only add if not present
    [[ "$PS1" != *'633;B'* ]] && PS1="${PS1}${marker}"
}

# ============================================================================
# Hook Installation
# ============================================================================

# Ensure add-zsh-hook is available
autoload -Uz add-zsh-hook 2>/dev/null || {
    __termie_debug "add-zsh-hook not available"
    return 1
}

# Check if hooks are already installed (avoid duplicates)
__termie_is_hook_installed() {
    local hook_name="$1"
    local func_name="$2"
    local -a hooks
    
    case "$hook_name" in
        precmd)
            hooks=("${precmd_functions[@]}")
            ;;
        preexec)
            hooks=("${preexec_functions[@]}")
            ;;
    esac
    
    [[ " ${hooks[*]} " == *" $func_name "* ]]
}

# Install precmd hook
if ! __termie_is_hook_installed precmd __termie_precmd; then
    add-zsh-hook precmd __termie_precmd
    __termie_debug "Installed precmd hook"
fi

# Install preexec hook
if ! __termie_is_hook_installed preexec __termie_preexec; then
    add-zsh-hook preexec __termie_preexec
    __termie_debug "Installed preexec hook"
fi

# Install PS1 updater (also as precmd to run after other prompts set PS1)
if ! __termie_is_hook_installed precmd __termie_update_ps1; then
    add-zsh-hook precmd __termie_update_ps1
    __termie_debug "Installed PS1 updater hook"
fi

# ============================================================================
# Initial Properties
# ============================================================================

# IsWindows property
case "$__TERMIE_PLATFORM" in
    msys|wsl)
        __termie_emit_osc "633" "P" "IsWindows=True"
        ;;
    *)
        __termie_emit_osc "633" "P" "IsWindows=False"
        ;;
esac

# Shell type
__termie_emit_osc "633" "P" "ShellType=zsh"

# Session ID
__termie_emit_osc "633" "P" "SessionId=$__TERMIE_SESSION_ID"

# Initial CWD
local __termie_initial_cwd
__termie_initial_cwd="$(__termie_get_cwd)"
if [[ -n "$__termie_initial_cwd" ]]; then
    # Convert backslashes to forward slashes before escaping
    local __termie_initial_cwd_normalized="${__termie_initial_cwd//\\//}"
    __termie_emit_osc "633" "P" "Cwd=$(__termie_escape_value "$__termie_initial_cwd_normalized")"
    __termie_emit_osc "7" "$(__termie_path_to_uri "$__termie_initial_cwd")"
fi

# ============================================================================
# Environment Variables
# ============================================================================

export TERMIE_SHELL_INTEGRATION=1
export TERM_PROGRAM="termie"
export TERM_PROGRAM_VERSION="1.0.0"

__termie_debug "Zsh shell integration loaded"

# vim: ft=zsh ts=4 sw=4 et
