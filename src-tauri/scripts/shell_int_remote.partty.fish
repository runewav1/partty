# Partty shell integration for fish on remote SSH hosts (OSC 633 / OSC 7).
#
# Install: copy to the remote machine and source from ~/.config/fish/config.fish:
#   source /path/to/shell_int_remote.partty.fish
#
# Windows remotes: use shell_int_remote.partty.ps1 in $PROFILE instead.
#
# Once loaded, set integration = true on the matching Partty SSH profile.

if set -q __PARTTY_SHELL_INTEGRATION
    return
end
set -g __PARTTY_SHELL_INTEGRATION 1

function __partty_escape_value -a input
    set -l output ""
    set -l len (string length -- "$input")
    if test "$len" -eq 0
        return
    end
    for i in (seq $len)
        set -l char (string sub -s $i -l 1 -- "$input")
        set -l byte (printf '%d' "'$char")
        if test $byte -lt 32 -o $byte -eq 59 -o $byte -eq 92 -o $byte -eq 127
            set output "$output\\x"(printf '%02x' $byte)
        else
            set output "$output$char"
        end
    end
    printf '%s' "$output"
end

function __partty_get_cwd
    printf '%s' "$PWD"
end

function __partty_path_to_uri -a path
    set path (string replace -a '\\' '/' -- "$path")
    set -l encoded ""
    for i in (seq (string length -- "$path"))
        set -l char (string sub -s $i -l 1 -- "$path")
        switch $char
            case 'a' 'b' 'c' 'd' 'e' 'f' 'g' 'h' 'i' 'j' 'k' 'l' 'm' 'n' 'o' 'p' 'q' 'r' 's' 't' 'u' 'v' 'w' 'x' 'y' 'z'
                set encoded "$encoded$char"
            case 'A' 'B' 'C' 'D' 'E' 'F' 'G' 'H' 'I' 'J' 'K' 'L' 'M' 'N' 'O' 'P' 'Q' 'R' 'S' 'T' 'U' 'V' 'W' 'X' 'Y' 'Z'
                set encoded "$encoded$char"
            case '0' '1' '2' '3' '4' '5' '6' '7' '8' '9' '.' '_' '~' ':' '/' '-'
                set encoded "$encoded$char"
            case ' '
                set encoded "$encoded%20"
            case '*'
                set encoded "$encoded"(printf '%%%02X' "'$char")
        end
    end
    if string match -q '//*' -- "$encoded"
        printf 'file:%s' "$encoded"
    else if string match -qr '^[A-Za-z]:' -- "$encoded"
        printf 'file:///%s' "$encoded"
    else if string match -q '/*' -- "$encoded"
        printf 'file://%s' "$encoded"
    else
        printf 'file:///%s' "$encoded"
    end
end

function __partty_emit_osc -a code
    set -l payload "$code"
    if test (count $argv) -gt 1
        set payload "$payload;"(string join ';' $argv[2..-1])
    end
    printf '\e]%s\a' "$payload"
end

function __partty_emit_osc_batch
    for seq in $argv
        printf '\e]%s\a' "$seq"
    end
end

set -g __PARTTY_HAS_RUN 0
set -g __PARTTY_CURRENT_CMD ""

function __partty_fish_precmd --on-event fish_prompt
    set -l exit_code $status
    set -l sequences

    if test "$__PARTTY_HAS_RUN" = 1
        if test -n "$__PARTTY_CURRENT_CMD"
            set -a sequences "633;D;$exit_code"
        else
            set -a sequences "633;D"
        end
    end
    set -g __PARTTY_HAS_RUN 0
    set -g __PARTTY_CURRENT_CMD ""

    set -a sequences "633;A"
    set -l cwd (__partty_get_cwd)
    if test -n "$cwd"
        set -l cwd_normalized (string replace -a '\\' '/' -- "$cwd")
        set -a sequences "633;P;Cwd="(__partty_escape_value "$cwd_normalized")
        set -a sequences "7;"(__partty_path_to_uri "$cwd")
    end
    __partty_emit_osc_batch $sequences
end

function __partty_fish_preexec --on-event fish_preexec
    set -g __PARTTY_HAS_RUN 1
    set -l cmd (string join ' ' -- $argv)
    set -g __PARTTY_CURRENT_CMD "$cmd"
    set cmd (string trim -- "$cmd")
    if test -z "$cmd"
        return
    end
    __partty_emit_osc 633 E (__partty_escape_value "$cmd")
    __partty_emit_osc 633 C
end

function __partty_fish_prompt_end
    __partty_emit_osc 633 B
end

if functions -q fish_prompt
    functions -c fish_prompt __partty_original_fish_prompt
end

function fish_prompt
    if functions -q __partty_original_fish_prompt
        __partty_original_fish_prompt
    else
        printf '%s> ' (prompt_pwd)
    end
    __partty_fish_prompt_end
end

__partty_emit_osc 633 P IsWindows=False

set -l __PARTTY_INITIAL_CWD (__partty_get_cwd)
if test -n "$__PARTTY_INITIAL_CWD"
    set -l initial_normalized (string replace -a '\\' '/' -- "$__PARTTY_INITIAL_CWD")
    __partty_emit_osc 633 P Cwd=(__partty_escape_value "$initial_normalized")
    __partty_emit_osc 7 (__partty_path_to_uri "$__PARTTY_INITIAL_CWD")
end

set -gx PARTTY_SHELL_INTEGRATION 1
if set -q TERM_PROGRAM
    set -gx TERM_PROGRAM $TERM_PROGRAM
else
    set -gx TERM_PROGRAM Partty
end
if set -q TERM_PROGRAM_VERSION
    set -gx TERM_PROGRAM_VERSION $TERM_PROGRAM_VERSION
else
    set -gx TERM_PROGRAM_VERSION 0.4.0
end
