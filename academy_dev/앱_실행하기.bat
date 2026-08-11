@echo off
title Academy Manager (Local)
set APP_ENV=local
cd /d "%~dp0"

echo ================================
echo   Starting Academy Manager (Local)
echo ================================
echo.

python wake_db.py

start "" cmd /c "timeout /t 4 >nul & start http://localhost:8501"

python -m streamlit run app.py

echo.
echo Program has stopped. Closing this window will fully stop the program.
pause
