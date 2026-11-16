@echo off
rem Astra pipeline — planner wrapper. Called by the n8n "Planner (Fable)" node.
rem Fills the planner prompt with the current item and runs a headless Claude Code
rem session on the Fable model. Prints Claude's JSON result on stdout for n8n to parse.
setlocal
cd /d "%~dp0..\.."
node automation\scripts\pipeline.mjs prompt planner > automation\state\planner-prompt.txt
if errorlevel 1 exit /b 1
rem stderr goes to a log file so a failed run can be diagnosed afterwards (n8n keeps only the
rem exit status and stdout of a failed Execute Command node).
claude -p --output-format json --permission-mode acceptEdits --model claude-fable-5 < automation\state\planner-prompt.txt 2> automation\state\planner.err.log
