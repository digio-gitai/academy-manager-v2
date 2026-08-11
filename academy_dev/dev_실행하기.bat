@echo off
title Academy Manager (DEV)
set APP_ENV=dev
cd /d "%~dp0"

echo ================================
echo   Starting Academy Manager DEV
echo   Port 8502 (production stays on 8501)
echo ================================
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:8502"

python -m streamlit run app.py --server.port 8502

echo.
echo DEV program has stopped.
pause
