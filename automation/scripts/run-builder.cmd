@echo off
rem Astra pipeline — builder wrapper. Called by the n8n "Builder (Opus)" node after Gate 1.
rem Fills the builder prompt with the current item and runs a headless Claude Code
rem session on the Opus model. Prints Claude's JSON result on stdout for n8n to parse.
setlocal
cd /d "%~dp0..\.."
node automation\scripts\pipeline.mjs prompt builder > automation\state\builder-prompt.txt
if errorlevel 1 exit /b 1
rem stdout and stderr both go to log files first (n8n keeps neither when a command fails),
rem then stdout is replayed for n8n and the exit code is preserved.
claude -p --output-format json --permission-mode acceptEdits --model claude-opus-5-5 < automation\state\builder-prompt.txt > automation\state\builder.out.log 2> automation\state\builder.err.log
set RC=%ERRORLEVEL%
type automation\state\builder.out.log
exit /b %RC%
