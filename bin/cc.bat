@echo off
REM cc.bat — Claude Code wrapper for Windows that registers with Claude Watch
REM Usage: cc [args...]
REM Note: Windows support is experimental. Focus terminal may not work.

setlocal enabledelayedexpansion

set PIPE_NAME=\\.\pipe\claude-watch
set TERMINAL_APP=cmd
set TERMINAL_ID=%RANDOM%

if defined WT_SESSION (
    set TERMINAL_APP=WindowsTerminal
    set TERMINAL_ID=%WT_SESSION%
)

REM Get current PID via PowerShell (the batch script PID, which exec will replace)
for /f %%a in ('powershell -NoProfile -Command "$PID"') do set MY_PID=%%a

REM Notify Claude Watch via named pipe (best effort)
echo {"action":"register","pid":%MY_PID%,"terminalApp":"%TERMINAL_APP%","terminalId":"%TERMINAL_ID%","cwd":"%CD%"} > %PIPE_NAME% 2>nul

REM Launch Claude Code in foreground (replaces this process)
claude %*

endlocal
