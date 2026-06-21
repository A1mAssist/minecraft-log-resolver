@echo off
setlocal

echo Stopping Minecraft Log Observatory services...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*scripts/api.mjs*' -or $_.CommandLine -like '*scripts/serve.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped PID ' + $_.ProcessId) }"

echo Done.
