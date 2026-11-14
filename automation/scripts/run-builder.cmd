@echo off
rem Astra pipeline — builder wrapper. Called by the n8n "Builder (Opus)" node after Gate 1.
rem Fills the builder prompt with the current item and runs a headless Claude Code
rem session on the Opus model. Prints Claude's JSON result on stdout for n8n to parse.
setlocal
cd /d "%~dp0..\.."
node automation\scripts\pipeline.mjs prompt builder > automation\state\builder-prompt.txt
if errorlevel 1 exit /b 1
claude -p --output-format json --permission-mode acceptEdits --model claude-opus-5-5 < automation\state\builder-prompt.txt
