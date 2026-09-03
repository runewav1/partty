#!/bin/zsh
# Partty shell integration for zsh (OSC 633 / OSC 7).
# Used for Windows zsh and WSL zsh (injected via ZDOTDIR wrapper).

[[ -n "$__PARTTY_SHELL_INTEGRATION" ]] && return 0
typeset -g __PARTTY_SHELL_INTEGRATION=1

__partty_detect_platform() {
  case "$(uname -s 2>/dev/null)" in
    CYGWIN*|MSYS*|MINGW*) print msys ;;
    Linux)
      if [[ -n "$WSL_DISTRO_NAME" ]] || grep -qiE '(Microsoft|WSL)' /proc/version 2>/dev/null; then
        print wsl
      else
        print linux
      fi
      ;;
    Darwin*) print macos ;;
    *) print unix ;;
  esac
}
typeset -g __PARTTY_PLATFORM="$(__partty_detect_platform)"

__partty_escape_value() {
  local input="$1"
  local result=""
  local char byte
  local i
  for ((i = 1; i <= ${#input}; i++)); do
    char="${input[i]}"
    byte=$(( #char ))
    if (( byte < 32 || byte == 59 || byte == 92 || byte == 127 )); then
      result+=$(printf '\\x%02x' "$byte")
    else
      result+="$char"
    fi
  done
  print -rn -- "$result"
}

__partty_msys_to_win_path() {
  local p="$1"
  if [[ "$p" =~ '^/([a-zA-Z])(/.*)?$' ]]; then
    print -rn -- "${(U)match[1]}:${match[2]}"; return
  fi
  if [[ "$p" =~ '^/cygdrive/([a-zA-Z])(/.*)?$' ]]; then
    print -rn -- "${(U)match[1]}:${match[2]}"; return
  fi
  if (( $+commands[cygpath] )); then
    cygpath -w "$p" 2>/dev/null && return
  fi
  print -rn -- "$p"
}

__partty_wsl_to_win_path() {
  local p="$1"
  [[ "$p" =~ '^[A-Za-z]:' || "$p" == \\\\* || "$p" == //* ]] && {
    print -rn -- "$p"; return
  }
  if (( $+commands[wslpath] )); then
    local win_path
    win_path="$(wslpath -w "$p" 2>/dev/null)"
    [[ -n "$win_path" ]] && { print -rn -- "$win_path"; return; }
  fi
  print -rn -- "$p"
}

__partty_get_cwd() {
  local cwd="${PWD:-$(pwd)}"
  case "$__PARTTY_PLATFORM" in
    msys) __partty_msys_to_win_path "$cwd" ;;
    wsl) __partty_wsl_to_win_path "$cwd" ;;
    *) print -rn -- "$cwd" ;;
  esac
}

__partty_path_to_uri() {
  local p="${1//\\//}"
  local encoded=""
  local char
  local i
  for ((i = 1; i <= ${#p}; i++)); do
    char="${p[i]}"
    case "$char" in
      [a-zA-Z0-9._~:/_-]) encoded+="$char" ;;
      ' ') encoded+="%20" ;;
      *) encoded+=$(printf '%%%02X' "'$char") ;;
    esac
  done
  if [[ "$encoded" == //* ]]; then
    print -rn -- "file:$encoded"
  elif [[ "$encoded" =~ '^[A-Za-z]:' ]]; then
    print -rn -- "file:///$encoded"
  elif [[ "$encoded" == /* ]]; then
    print -rn -- "file://$encoded"
  else
    print -rn -- "file:///$encoded"
  fi
}

__partty_emit_osc() {
  local code="$1"; shift
  local payload="$code"
  local arg
  for arg in "$@"; do
    payload+=";${arg}"
  done
  print -Pn "\e]${payload}\a"
}

__partty_emit_osc_batch() {
  local seq
  for seq in "$@"; do
    print -Pn "\e]${seq}\a"
  done
}

typeset -g __PARTTY_HAS_RUN=0
typeset -g __PARTTY_CURRENT_CMD=""
typeset -g __PARTTY_IN_PROMPT=0
typeset -g __PARTTY_SESSION_ID
__PARTTY_SESSION_ID="$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
[[ -z "$__PARTTY_SESSION_ID" ]] && __PARTTY_SESSION_ID="$$"

__partty_precmd() {
  local exit_code=$?
  (( __PARTTY_IN_PROMPT )) && return
  __PARTTY_IN_PROMPT=1
  local -a sequences
  if (( __PARTTY_HAS_RUN )); then
    if [[ -n "$__PARTTY_CURRENT_CMD" ]]; then
      sequences+=("633;D;$exit_code")
    else
      sequences+=("633;D")
    fi
  fi
  __PARTTY_HAS_RUN=0
  __PARTTY_CURRENT_CMD=""
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
  __PARTTY_CURRENT_CMD="$cmd"
  [[ -z "${cmd// /}" ]] && return
  __partty_emit_osc "633" "E" "$(__partty_escape_value "$cmd")"
  __partty_emit_osc "633" "C"
}

__partty_update_ps1() {
  local marker=$'%{\e]633;B\a%}'
  [[ "$PS1" != *'633;B'* ]] && PS1="${PS1}${marker}"
}

autoload -Uz add-zsh-hook 2>/dev/null || return 1
add-zsh-hook precmd __partty_precmd
add-zsh-hook preexec __partty_preexec
add-zsh-hook precmd __partty_update_ps1

case "$__PARTTY_PLATFORM" in
  msys|wsl) __partty_emit_osc "633" "P" "IsWindows=True" ;;
  *) __partty_emit_osc "633" "P" "IsWindows=False" ;;
esac
__partty_emit_osc "633" "P" "ShellType=zsh"
__partty_emit_osc "633" "P" "SessionId=$__PARTTY_SESSION_ID"
__partty_emit_osc "633" "P" "HasRichCommandDetection=True"

typeset -g __PARTTY_INITIAL_CWD
__PARTTY_INITIAL_CWD="$(__partty_get_cwd)"
if [[ -n "$__PARTTY_INITIAL_CWD" ]]; then
  __partty_emit_osc "633" "P" "Cwd=$(__partty_escape_value "${__PARTTY_INITIAL_CWD//\\//}")"
  __partty_emit_osc "7" "$(__partty_path_to_uri "$__PARTTY_INITIAL_CWD")"
fi

export PARTTY_SHELL_INTEGRATION=1
export TERM_PROGRAM="${TERM_PROGRAM:-Partty}"
export TERM_PROGRAM_VERSION="${TERM_PROGRAM_VERSION:-0.4.0}"
