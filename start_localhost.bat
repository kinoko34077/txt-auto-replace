@echo off
setlocal
cd /d "%~dp0"
echo Starting local test server...
echo.
echo   index.html: http://127.0.0.1:8000/index.html
echo   debug.html: http://127.0.0.1:8000/debug.html
echo.
python tools\serve_local.py
