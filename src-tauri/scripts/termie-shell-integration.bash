#!/bin/bash
# Termie shell integration for bash (improved).

[[ -n "$__TERMIE_SHELL_INTEGRATION" ]] && return 0
export __TERMIE_SHELL_INTEGRATION=1

__termie_escape_value() {
  local input="$1"
  local output=""
  local i char dec
  for ((i = 0; i < ${#input}; i++)); do
    char="${input:i:1}"
    printf -v dec '%d' "'$char" 2>/dev/null || dec=0
    if ((dec < 32 || dec == 59 || dec == 92 || dec == 127)); then
      printf -v output '%s\\x%02x' "$output" "$dec"
    else
      output+="$char"
    fi
  done
  printf '%s' "$output"
}

__termie_detect_platform() {
  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo 'Unknown')"
  case "$uname_s" in
    CYGWIN*|MSYS*|MINGW*|MINGW32*|MINGW64*) echo "msys" ;;
    Linux)
      if [[ -n "$WSL_DISTRO_NAME" ]] || grep -qiE '(Microsoft|WSL)' /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    Darwin*) echo "macos" ;;
    *) echo "unix" ;;
  esac
}

__TERMIE_PLATFORM="$(__termie_detect_platform)"

__termie_msys_to_win_path() {
  local path="$1"
  if [[ "$path" =~ ^/([a-zA-Z])(/.*)?$ ]]; then
    printf '%s:%s' "${BASH_REMATCH[1]^^}" "${BASH_REMATCH[2]}"
    return
  fi
  if [[ "$path" =~ ^/cygdrive/([a-zA-Z])(/.*)?$ ]]; then
    printf '%s:%s' "${BASH_REMATCH[1]^^}" "${BASH_REMATCH[2]}"
    return
  fi
  if [[ "$path" == /* ]] && command -v cygpath &>/dev/null; then
    cygpath -w "$path" 2>/dev/null && return
  fi
  printf '%s' "$path"
}

__termie_wsl_to_win_path() {
  local path="$1"
  if [[ "$path" =~ ^[A-Za-z]: ]]; then
    printf '%s' "$path"
    return
  fi
  if command -v wslpath &>/dev/null; then
    local win_path
    win_path="$(wslpath -w "$path" 2>/dev/null)"
    if [[ -n "$win_path" ]]; then
      printf '%s' "$win_path"
      return
    fi
  fi
  printf '%s' "$path"
}

__termie_get_cwd() {
  local cwd="${PWD:-$(pwd 2>/dev/null)}"
  case "$__TERMIE_PLATFORM" in
    msys) cwd="$(__termie_msys_to_win_path "$cwd")" ;;
    wsl) cwd="$(__termie_wsl_to_win_path "$cwd")" ;;
  esac
  printf '%s' "$cwd"
}

__termie_path_to_uri() {
  local path="$1"
  local encoded=""
  local i char hex
  for ((i = 0; i < ${#path}; i++)); do
    char="${path:i:1}"
    case "$char" in
      [a-zA-Z0-9._~:/-]) encoded+="$char" ;;
      ' ') encoded+="%20" ;;
      *) printf -v hex '%02X' "'$char"; encoded+="%$hex" ;;
    esac
  done
  encoded="${encoded//\\//}"
  if [[ "$encoded" == //* ]]; then
    printf 'file:%s' "$encoded"
  elif [[ "$encoded" =~ ^[A-Za-z]: ]]; then
    printf 'file:///%s' "$encoded"
  elif [[ "$encoded" == /* ]]; then
    printf 'file://%s' "$encoded"
  else
    printf 'file:///%s' "$encoded"
  fi
}

__termie_emit_osc() {
  local code="$1"; shift
  local payload="$code"
  [[ $# -gt 0 ]] && payload+=";$*"
  printf '\e]%s\a' "$payload"
}

__termie_emit_osc_batch() {
  local seq
  for seq in "$@"; do
    printf '\e]%s\a' "$seq"
  done
}

__TERMIE_HAS_RUN=0
__TERMIE_LAST_HIST_NUM=""
__TERMIE_IN_PROMPT=0

__termie_precmd() {
  local exit_code=$?
  [[ "$__TERMIE_IN_PROMPT" == "1" ]] && return
  __TERMIE_IN_PROMPT=1
  local sequences=()
  if [[ "$__TERMIE_HAS_RUN" == "1" ]]; then
    local current_hist_num
    current_hist_num="$(history 1 2>/dev/null | awk '{print $1}')"
    if [[ -n "$current_hist_num" && "$current_hist_num" != "$__TERMIE_LAST_HIST_NUM" ]]; then
      sequences+=("633;D;$exit_code")
      __TERMIE_LAST_HIST_NUM="$current_hist_num"
    else
      sequences+=("633;D")
    fi
  fi
  __TERMIE_HAS_RUN=0
  sequences+=("633;A")
  local cwd
  cwd="$(__termie_get_cwd)"
  if [[ -n "$cwd" ]]; then
    local cwd_normalized="${cwd//\\//}"
    sequences+=("633;P;Cwd=$(__termie_escape_value "$cwd_normalized")")
    sequences+=("7;$(__termie_path_to_uri "$cwd")")
  fi
  __termie_emit_osc_batch "${sequences[@]}"
  __TERMIE_IN_PROMPT=0
}

__termie_preexec() {
  local cmd="$1"
  __TERMIE_HAS_RUN=1
  [[ -z "${cmd// /}" ]] && return
  __termie_emit_osc "633" "E" "$(__termie_escape_value "$cmd")"
  __termie_emit_osc "633" "C"
}

__termie_update_ps1() {
  local marker=$'\e]633;B\a'
  [[ "$PS1" != *'633;B'* ]] && PS1="${PS1}\[$marker\]"
}

if [[ -n "$BASH_VERSION" ]]; then
  if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="__termie_precmd; __termie_update_ps1"
  elif [[ "$PROMPT_COMMAND" != *"__termie_precmd"* ]]; then
    PROMPT_COMMAND="__termie_precmd; __termie_update_ps1; $PROMPT_COMMAND"
  fi

  __termie_debug_trap() {
    case "$BASH_COMMAND" in
      __termie_*|'__termie_precmd'*|'__termie_update_ps1'*|'__termie_debug_trap'*)
        return
        ;;
      "$PROMPT_COMMAND"|"$PROMPT_COMMAND;"*)
        return
        ;;
    esac
    [[ "$BASH_SUBSHELL" -gt 0 ]] && return
    [[ -z "$BASH_COMMAND" ]] && return
    __termie_preexec "$BASH_COMMAND"
  }
  trap '__termie_debug_trap' DEBUG
fi

case "$__TERMIE_PLATFORM" in
  msys|wsl) __termie_emit_osc "633" "P" "IsWindows=True" ;;
  *) __termie_emit_osc "633" "P" "IsWindows=False" ;;
esac
__termie_emit_osc "633" "P" "ShellType=bash"
export TERMIE_SHELL_INTEGRATION=1
export TERM_PROGRAM="termie"
export TERM_PROGRAM_VERSION="1.0.0"
