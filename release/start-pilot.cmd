@echo off
chcp 65001 >nul
setlocal EnableExtensions
set "ROOT=%~dp0"
set "NODE=%ROOT%runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
where "%NODE%" >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到内置 Node.js 运行时。
  echo 请确认你是从完整的“下单工作台-v0.1.0-pilot”文件夹启动。
  pause
  exit /b 1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8791 .*LISTENING"') do set "PID=%%p"
if defined PID (
  echo 工作台已在运行，正在打开现有页面。
  start "" "http://127.0.0.1:8791/"
  exit /b 0
)
start "下单工作台服务" /min "%NODE%" "%ROOT%server.mjs"
for /l %%i in (1,1,30) do (
  powershell -NoProfile -Command "try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8791/health).StatusCode -eq 200) { exit 0 } } catch {} ; exit 1" >nul 2>nul
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)
echo [错误] 工作台启动超时，请联系维护人员并提供错误截图。
pause
exit /b 1
:ready
start "" "http://127.0.0.1:8791/"
echo 下单工作台已启动：http://127.0.0.1:8791/
exit /b 0
