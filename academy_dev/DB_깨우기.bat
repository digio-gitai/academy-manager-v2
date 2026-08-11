@echo off
title Wake Supabase DB
cd /d "%~dp0"

echo ================================
echo   Waking up Supabase DB...
echo ================================
echo.

python wake_db.py

echo.
echo Done. You can close this window.
pause
