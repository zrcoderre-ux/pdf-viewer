@echo off
rem Double-click to show the PDF Viewer logo on the files the app opens.
rem See windows-file-icon.ps1 for what it changes.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-file-icon.ps1"
pause
