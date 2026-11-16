@echo off
rem Astra pipeline — planner wrapper. Called by the n8n "Planner (Fable)" node.
rem Fills the planner prompt with the current item and runs a headless Claude Code
rem session on the Fable model. Prints Claude's JSON result on stdout for n8n to parse.
setlocal
cd /d "%~dp0..\.."
node automation\scripts\pipeline.mjs prompt planner > automation\state\planner-prompt.txt
if errorlevel 1 exit /b 1
rem stdout and stderr both go to log files first (n8n keeps neither when a command fails),
rem then stdout is replayed for n8n and the exit code is preserved.
claude -p --output-format json --permission-mode acceptEdits --model claude-fable-5 < automation\state\planner-prompt.txt > automation\state\planner.out.log 2> automation\state\planner.err.log
set RC=%ERRORLEVEL%
type automation\state\planner.out.log
exit /b %RC%
