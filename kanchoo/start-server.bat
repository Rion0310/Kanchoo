@echo off
cd /d "%~dp0server"

if not exist node_modules\ws (
    echo Installing WebSocket server package...
    call npm install
)

echo.
echo MONSTER WAR SERVER
echo http://localhost:8080/title/title.html
echo.
node server.js
pause
