@echo off
cd /d "%~dp0"
call node setup-ai.js
if errorlevel 1 (echo AI files could not be downloaded. Check your internet connection. & pause & exit /b 1)
call npm install
call npm run dist
echo.
echo Done: ORPHEUS installer + portable exe. Output is in the "dist" folder.
pause
