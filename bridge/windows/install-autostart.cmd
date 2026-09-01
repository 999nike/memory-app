@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" -StartNow
if errorlevel 1 (
  echo.
  echo Memory Space Bridge autostart setup failed.
  exit /b 1
)
echo.
echo Memory Space Bridge autostart is installed.
exit /b 0
