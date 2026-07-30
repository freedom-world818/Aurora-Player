@echo off
chcp 65001 >nul
title Aurora Player

cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     🎵  Aurora Player 启动中…      ║
echo   ╚══════════════════════════════════════╝
echo.
echo   正在启动网易云 API + 播放器服务…
echo.

node server.js

echo.
echo   服务已关闭。
pause
