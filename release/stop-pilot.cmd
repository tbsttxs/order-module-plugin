@echo off
chcp 65001 >nul
for %%a in (8791 8790 8787) do for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%%a .*LISTENING"') do taskkill /PID %%p /T /F >nul 2>nul
echo 下单工作台已停止。不会删除账号凭据、Chrome 配置或历史结果。
