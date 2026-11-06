@echo off
setlocal

set PORT=4173

echo Stopping MANSHIGUANG server on port %PORT%...

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul

echo Done.

pause