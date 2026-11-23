@echo off
rem One-time setup for a new computer: installs the tools, makes the deploy key,
rem downloads the pictures repo and puts an "Import Pictures" shortcut on the Desktop.
rem Works double-clicked or typed at a cmd or PowerShell prompt, from any folder.
setlocal EnableDelayedExpansion
title Setup

rem Double-clicked windows close at the end, so only those pause; a prompt stays open anyway.
set "DOUBLE_CLICKED="
echo(!cmdcmdline!| findstr /i /c:"%~nx0" >nul && set "DOUBLE_CLICKED=1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set "RESULT=!errorlevel!"

if defined DOUBLE_CLICKED (
  echo.
  pause
)
exit /b %RESULT%
