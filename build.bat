@echo off
cd /d "%~dp0"
call npm install
call npm run dist
echo.
echo Done: ORPHEUS installer + portable exe. Output is in the "dist" folder.
pause
