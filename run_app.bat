@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Starting AILA development app...
echo.

if not exist "backend\.env" if exist "backend\.env.example" (
  echo Creating backend\.env from backend\.env.example
  copy "backend\.env.example" "backend\.env" >nul
)

if not exist "frontend\.env" if exist "frontend\.env.example" (
  echo Creating frontend\.env from frontend\.env.example
  copy "frontend\.env.example" "frontend\.env" >nul
)


if not exist "backend\.venv\Scripts\python.exe" (
  echo Could not create backend virtual environment. Install Python 3.11+ and try again.
  pause
  exit /b 1
)


if not exist "frontend\node_modules" (
  echo Installing frontend dependencies...
  pushd "frontend"
  call npm install
  if errorlevel 1 (
    popd
    echo Frontend dependency installation failed.
    pause
    exit /b 1
  )
  popd
)

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.

start "AILA Backend" /D "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload"
start "AILA Frontend" /D "%ROOT%frontend" cmd /k "npm run dev"

echo App windows opened. Keep them running while you use the app.
pause
