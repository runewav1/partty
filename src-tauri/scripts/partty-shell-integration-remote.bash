#!/bin/bash
# Partty shell integration for bash on remote SSH hosts (OSC 633 / OSC 7).
#
# Install: copy to the remote machine and source from ~/.bashrc (or ~/.bash_profile):
#   source /path/to/partty-shell-integration-remote.bash
#
# Windows remotes: use partty-shell-integration-remote.ps1 in $PROFILE instead.
#
# Once loaded, set integration = true on the matching Partty SSH profile.

[[ -n "$__PARTTY_SHELL_INTEGRATION" ]] && return 0
export __PARTTY_SHELL_INTEGRATION=1

__partty_escape_value() {
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

__partty_get_cwd() {
  printf '%s' "${PWD:-$(pwd 2>/dev/null)}"
}

__partty_path_to_uri() {
  local path="${1//\\//}"
  local encoded=""
  local i char hex
  for ((i = 0; i < ${#path}; i++)); do
    char="${path:i:1}"
    case "$char" in
    [a-zA-Z0-9._~:/-]) encoded+="$char" ;;
    ' ') encoded+="%20" ;;
    *)
      printf -v hex '%02X' "'$char"
      encoded+="%$hex"
      ;;
    esac
  done
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

__partty_emit_osc() {
  local code="$1"
  shift
  local payload="$code"
  [[ $# -gt 0 ]] && payload+=";$*"
  printf '\e]%s\a' "$payload"
}

__partty_emit_osc_batch() {
  local seq
  for seq in "$@"; do
    printf '\e]%s\a' "$seq"
  done
}

__PARTTY_HAS_RUN=0
__PARTTY_LAST_HIST_NUM=""
__PARTTY_IN_PROMPT=0

__partty_precmd() {
  local exit_code=$?
  [[ "$__PARTTY_IN_PROMPT" == "1" ]] && return
  __PARTTY_IN_PROMPT=1
  local sequences=()
  if [[ "$__PARTTY_HAS_RUN" == "1" ]]; then
    local current_hist_num
    current_hist_num="$(history 1 2>/dev/null | awk '{print $1}')"
    if [[ -n "$current_hist_num" && "$current_hist_num" != "$__PARTTY_LAST_HIST_NUM" ]]; then
      sequences+=("633;D;$exit_code")
      __PARTTY_LAST_HIST_NUM="$current_hist_num"
    else
      sequences+=("633;D")
    fi
  fi
  __PARTTY_HAS_RUN=0
  sequences+=("633;A")
  local cwd
  cwd="$(__partty_get_cwd)"
  if [[ -n "$cwd" ]]; then
    local cwd_normalized="${cwd//\\//}"
    sequences+=("633;P;Cwd=$(__partty_escape_value "$cwd_normalized")")
    sequences+=("7;$(__partty_path_to_uri "$cwd")")
  fi
  __partty_emit_osc_batch "${sequences[@]}"
  __PARTTY_IN_PROMPT=0
}

__partty_preexec() {
  local cmd="$1"
  __PARTTY_HAS_RUN=1
  [[ -z "${cmd// /}" ]] && return
  __partty_emit_osc "633" "E" "$(__partty_escape_value "$cmd")"
  __partty_emit_osc "633" "C"
}

__partty_update_ps1() {
  local marker=$'\e]633;B\a'
  [[ "$PS1" != *'633;B'* ]] && PS1="${PS1}\[$marker\]"
}

if [[ -n "$BASH_VERSION" ]]; then
  if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="__partty_precmd; __partty_update_ps1"
  elif [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    if [[ ! " ${PROMPT_COMMAND[*]} " =~ " __partty_precmd " ]]; then
      PROMPT_COMMAND=("__partty_precmd" "__partty_update_ps1" "${PROMPT_COMMAND[@]}")
    fi
  elif [[ "$PROMPT_COMMAND" != *"__partty_precmd"* ]]; then
    PROMPT_COMMAND="__partty_precmd; __partty_update_ps1; $PROMPT_COMMAND"
  fi

  __partty_debug_trap() {
    case "$BASH_COMMAND" in
    __partty_* | '__partty_precmd'* | '__partty_update_ps1'* | '__partty_debug_trap'*)
      return
      ;;
    "$PROMPT_COMMAND" | "$PROMPT_COMMAND;"*)
      return
      ;;
    esac
    [[ "$BASH_SUBSHELL" -gt 0 ]] && return
    [[ -z "$BASH_COMMAND" ]] && return
    __partty_preexec "$BASH_COMMAND"
  }
  trap '__partty_debug_trap' DEBUG
fi

__partty_emit_osc "633" "P" "IsWindows=False"

__PARTTY_INITIAL_CWD="$(__partty_get_cwd)"
if [[ -n "$__PARTTY_INITIAL_CWD" ]]; then
  __partty_emit_osc "633" "P" "Cwd=$(__partty_escape_value "${__PARTTY_INITIAL_CWD//\\//}")"
  __partty_emit_osc "7" "$(__partty_path_to_uri "$__PARTTY_INITIAL_CWD")"
fi

export PARTTY_SHELL_INTEGRATION=1
export TERM_PROGRAM="${TERM_PROGRAM:-Partty}"
export TERM_PROGRAM_VERSION="${TERM_PROGRAM_VERSION:-0.4.0}"
