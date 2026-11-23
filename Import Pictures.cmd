@echo off
rem Double-click to add the pictures in Documents\To_Import to the website.
rem Also works typed at a cmd or PowerShell prompt, from any folder.
setlocal EnableDelayedExpansion
title Import Pictures

rem Double-clicked windows close at the end, so only those pause; a prompt stays open anyway.
set "DOUBLE_CLICKED="
echo(!cmdcmdline!| findstr /i /c:"%~nx0" >nul && set "DOUBLE_CLICKED=1"

pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed on this computer. Ask Ryan to run Setup.
  set "RESULT=1"
) else (
  node scripts\import.mjs %*
  set "RESULT=!errorlevel!"
)
popd

if defined DOUBLE_CLICKED (
  echo.
  pause
)
exit /b %RESULT%
