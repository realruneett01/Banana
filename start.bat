@echo off
rem Banana launcher for Windows. Works from a USB stick: it prefers a Node.js shipped
rem in runtime\node-win32-x64\ (or -arm64) and falls back to the system Node.js.
setlocal
cd /d "%~dp0"

set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"

set "NODE_EXE="
if exist "runtime\node-win32-%ARCH%\node.exe" set "NODE_EXE=runtime\node-win32-%ARCH%\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo Node.js 20.11+ was not found. Install it from https://nodejs.org or copy a Node.js build to runtime\node-win32-%ARCH%\.
  pause
  exit /b 1
)
"%NODE_EXE%" scripts\launch.mjs %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
