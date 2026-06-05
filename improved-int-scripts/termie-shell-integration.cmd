@echo off
REM ============================================================================
REM Termie Shell Integration for Windows CMD
REM ============================================================================
REM NOTE: CMD has severe limitations compared to other shells:
REM   - No preexec hook (can't detect command execution)
REM   - No exit code tracking in prompt
REM   - Limited escape sequence support
REM
REM This script provides PARTIAL integration via PROMPT modification:
REM   - OSC 633;A (prompt start)
REM   - OSC 633;P;Cwd (current directory)
REM   - OSC 7 (file URI for cwd)
REM   - OSC 633;B (prompt end)
REM
REM Missing (due to CMD limitations):
REM   - OSC 633;C (pre-exec) - CMD has no preexec hook
REM   - OSC 633;D (command done) - No way to inject after command
REM   - OSC 633;E (command line) - Can't capture the command
REM
REM USAGE:
REM   Include this in your shell startup or call it manually.
REM   Or set: PROMPT=$E]633;A$G$E]633;P;Cwd=%CD%$G$E]7;file:///%CD%$G%CD%$G $E]633;B$G
REM ============================================================================

REM Guard: Check if already integrated
if defined __TERMIE_SHELL_INTEGRATION goto :EOF
set __TERMIE_SHELL_INTEGRATION=1

REM Store original prompt
if not defined __TERMIE_ORIGINAL_PROMPT set __TERMIE_ORIGINAL_PROMPT=%PROMPT%

REM ============================================================================
REM Build the integrated prompt
REM ============================================================================
REM PROMPT codes:
REM   $E = ESC character (0x1B)
REM   $G = Greater-than sign (>)
REM   $P = Current drive and path
REM   $_ = Newline
REM   $$ = Dollar sign
REM
REM OSC sequences use ESC ] ... BEL (but CMD doesn't support BEL in PROMPT)
REM We use ESC \ (ST) as terminator instead, which some terminals accept.
REM Actually, Windows Terminal and ConPTY accept $G$G which becomes >> but
REM that doesn't work. Let's try a different approach.
REM
REM The trick: CMD's $E only gives us ESC. For BEL (0x07), we need to be creative.
REM Modern terminals often accept ESC\ as ST (String Terminator) instead of BEL.
REM ============================================================================

REM Unfortunately, CMD prompt cannot directly include BEL character.
REM We'll use a hybrid approach: set up DOSKEY macros and a wrapper.

REM For basic CWD tracking, we can use PROMPT with OSC 7 only (simpler format):
REM Some terminals accept file:// URIs without full escaping

REM Build prompt with OSC sequences using $E for ESC
REM Format: ESC]7;file:///PATH ESC\  (using ST terminator)

REM Create a helper batch file that emits proper sequences
set "__TERMIE_HELPER=%TEMP%\termie-cmd-helper.cmd"

REM Write the helper script
(
echo @echo off
echo REM Emit OSC sequences for CMD integration
echo REM Called from PROMPT to emit CWD
echo.
echo REM Get current directory
echo set "TERMIE_CWD=%%CD%%"
echo.
echo REM Convert backslashes to forward slashes for URI
echo set "TERMIE_CWD_URI=%%TERMIE_CWD:\=/%%"
echo.
echo REM Emit OSC 633;A ^(prompt start^)
echo ^<nul set /p "=]633;A"
echo.
echo REM Emit OSC 633;P;Cwd=...
echo ^<nul set /p "=]633;P;Cwd=%%TERMIE_CWD%%"
echo.
echo REM Emit OSC 7;file:///...
echo ^<nul set /p "=]7;file:///%%TERMIE_CWD_URI%%"
) > "%__TERMIE_HELPER%" 2>nul

REM ============================================================================
REM Set the PROMPT with OSC integration
REM ============================================================================
REM This is the best we can do with CMD's limited PROMPT variable:
REM We embed OSC 7 for basic CWD tracking

REM OSC 7 format: ESC ] 7 ; file:///PATH BEL
REM In CMD PROMPT: $E]7;file:///$P$_$P$G 
REM But we can't emit BEL... So we try with ESC\ (ST)

REM Actually, let's test what works:
REM Windows Terminal and ConPTY should handle: ESC ] 7 ; URL ESC \

REM Set a minimal working prompt with OSC 7
REM $E = ESC, ]7; = OSC 7, file:/// prefix, $P = path, then ESC \, then normal prompt

REM Note: $E$\ doesn't work in CMD. We need actual escape sequences.
REM The only reliable way is to use a helper or PowerShell.

REM For now, set a simple prompt that at least identifies CMD
set PROMPT=$E]633;A$E\$E]633;P;Cwd=$P$E\$E]7;file:///$P$E\$P$G $E]633;B$E\

REM Alternative simpler version (just OSC 7):
REM set PROMPT=$E]7;file:///$P$E\$P$G 

REM Set environment markers
set TERM_PROGRAM=termie
set TERMIE_SHELL_INTEGRATION=1

REM Emit initial properties (this only works on script load, not in prompt)
REM We use PowerShell to emit sequences if available
where pwsh >nul 2>&1 && (
    pwsh -NoProfile -Command "[Console]::Write([char]0x1b + ']633;P;IsWindows=True' + [char]0x07)"
    pwsh -NoProfile -Command "[Console]::Write([char]0x1b + ']633;P;ShellType=cmd' + [char]0x07)"
) || where powershell >nul 2>&1 && (
    powershell -NoProfile -Command "[Console]::Write([char]0x1b + ']633;P;IsWindows=True' + [char]0x07)"
    powershell -NoProfile -Command "[Console]::Write([char]0x1b + ']633;P;ShellType=cmd' + [char]0x07)"
)

REM ============================================================================
REM DOSKEY Macros for command tracking (partial solution)
REM ============================================================================
REM DOSKEY can intercept some commands but it's very limited

REM Example: Track 'cd' command to emit CWD
REM doskey cd=cd $* ^&^& call "%__TERMIE_HELPER%"

echo [Termie CMD integration loaded - limited functionality]

:EOF
