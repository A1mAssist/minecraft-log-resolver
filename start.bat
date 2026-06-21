@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js 20+ or put a portable node.exe on PATH.
  pause
  exit /b 1
)

echo Starting Minecraft Log Observatory...
start "MLO API" /min node scripts/api.mjs --port 8787
timeout /t 1 /nobreak >nul
start "MLO Frontend" /min node scripts/serve.mjs

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173/"

echo.
echo Frontend: http://127.0.0.1:5173/
echo API:      http://127.0.0.1:8787/api/health
echo.
echo Use stop.bat to stop the local services.
