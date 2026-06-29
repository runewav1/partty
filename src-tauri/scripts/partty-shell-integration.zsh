#!/bin/zsh
# Partty shell integration for zsh (improved).

[[ -n "$__TERMIE_SHELL_INTEGRATION" ]] && return 0
typeset -g __TERMIE_SHELL_INTEGRATION=1

__termie_detect_platform() {
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
typeset -g __TERMIE_PLATFORM="$(__termie_detect_platform)"

__termie_escape_value() {
  local input="$1"
  local result=""
  local char byte
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

__termie_msys_to_win_path() {
  local path="$1"
  if [[ "$path" =~ '^/([a-zA-Z])(/.*)?$' ]]; then
    print -rn -- "${(U)match[1]}:${match[2]}"; return
  fi
  if [[ "$path" =~ '^/cygdrive/([a-zA-Z])(/.*)?$' ]]; then
    print -rn -- "${(U)match[1]}:${match[2]}"; return
  fi
  if (( $+commands[cygpath] )); then
    cygpath -w "$path" 2>/dev/null && return
  fi
  print -rn -- "$path"
}

__termie_wsl_to_win_path() {
  local path="$1"
  [[ "$path" =~ '^[A-Za-z]:' ]] && { print -rn -- "$path"; return; }
  if (( $+commands[wslpath] )); then
    local win_path
    win_path="$(wslpath -w "$path" 2>/dev/null)"
    [[ -n "$win_path" ]] && { print -rn -- "$win_path"; return; }
  fi
  print -rn -- "$path"
}

__termie_get_cwd() {
  local cwd="${PWD:-$(pwd)}"
  case "$__TERMIE_PLATFORM" in
    msys) __termie_msys_to_win_path "$cwd" ;;
    wsl) __termie_wsl_to_win_path "$cwd" ;;
    *) print -rn -- "$cwd" ;;
  esac
}

__termie_path_to_uri() {
  local path="$1"
  local encoded=""
  local char
  for ((i = 1; i <= ${#path}; i++)); do
    char="${path[i]}"
    case "$char" in
      [a-zA-Z0-9._~:/-]) encoded+="$char" ;;
      ' ') encoded+="%20" ;;
      \\) encoded+="/" ;;
      *) encoded+=$(printf '%%%02X' "'$char") ;;
    esac
  done
  encoded="${encoded//\\//}"
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

__termie_emit_osc() {
  local code="$1"; shift
  local payload="$code"
  (( $# > 0 )) && payload+=";$*"
  print -Pn "\e]${payload}\a"
}

__termie_emit_osc_batch() {
  local seq
  for seq in "$@"; do
    print -Pn "\e]${seq}\a"
  done
}

typeset -g __TERMIE_HAS_RUN=0
typeset -g __TERMIE_CURRENT_CMD=""
typeset -g __TERMIE_IN_PROMPT=0

__termie_precmd() {
  local exit_code=$?
  (( __TERMIE_IN_PROMPT )) && return
  __TERMIE_IN_PROMPT=1
  local -a sequences
  if (( __TERMIE_HAS_RUN )); then
    if [[ -n "$__TERMIE_CURRENT_CMD" ]]; then
      sequences+=("633;D;$exit_code")
    else
      sequences+=("633;D")
    fi
  fi
  __TERMIE_HAS_RUN=0
  __TERMIE_CURRENT_CMD=""
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
  __TERMIE_CURRENT_CMD="$cmd"
  [[ -z "${cmd// /}" ]] && return
  __termie_emit_osc "633" "E" "$(__termie_escape_value "$cmd")"
  __termie_emit_osc "633" "C"
}

__termie_update_ps1() {
  local marker=$'%{\e]633;B\a%}'
  [[ "$PS1" != *'633;B'* ]] && PS1="${PS1}${marker}"
}

autoload -Uz add-zsh-hook 2>/dev/null || return 1
add-zsh-hook precmd __termie_precmd
add-zsh-hook preexec __termie_preexec
add-zsh-hook precmd __termie_update_ps1

case "$__TERMIE_PLATFORM" in
  msys|wsl) __termie_emit_osc "633" "P" "IsWindows=True" ;;
  *) __termie_emit_osc "633" "P" "IsWindows=False" ;;
esac
__termie_emit_osc "633" "P" "ShellType=zsh"
export PARTTY_SHELL_INTEGRATION=1
export TERM_PROGRAM="partty"
export TERM_PROGRAM_VERSION="0.1.0"
