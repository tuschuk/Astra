@echo off
rem Astra pipeline — builder wrapper. Called by the n8n "Builder (Opus)" node after Gate 1.
rem Fills the builder prompt with the current item and runs a headless Claude Code
rem session on the Opus model. Prints Claude's JSON result on stdout for n8n to parse.
setlocal
cd /d "%~dp0..\.."
node automation\scripts\pipeline.mjs prompt builder > automation\state\builder-prompt.txt
if errorlevel 1 exit /b 1
rem stderr goes to a log file so a failed run can be diagnosed afterwards (n8n keeps only the
rem exit status and stdout of a failed Execute Command node).
claude -p --output-format json --permission-mode acceptEdits --model claude-opus-5-5 < automation\state\builder-prompt.txt 2> automation\state\builder.err.log
