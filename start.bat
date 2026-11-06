@echo off
setlocal

set PORT=4173

echo ========================================
echo   MANSHIGUANG local server
echo ========================================
echo.
echo   Main:  http://127.0.0.1:%PORT%/
echo   Canvas: http://127.0.0.1:%PORT%/canvas/index.html
echo   Gallery: http://127.0.0.1:%PORT%/gallery/index.html
echo.
echo   Close this window to stop the server
echo ========================================
echo.

start "" http://127.0.0.1:%PORT%/

python "%~dp0server.py" %PORT%

pause
