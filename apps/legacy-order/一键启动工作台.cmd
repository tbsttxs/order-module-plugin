@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "NODE=%ROOT%runtime\node.exe"
if not exist "%NODE%" set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" (
  mshta "javascript:alert('未找到运行环境。请使用团队安装包重新安装。');close()"
  exit /b 1
)
start "老品下单工作台守护服务" /min "%NODE%" "%ROOT%watchdog.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787"
