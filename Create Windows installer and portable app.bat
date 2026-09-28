@echo off
setlocal
pushd "%~dp0"
where npm >NUL 2>NUL
if errorlevel 1 (
  echo Node.js is needed to create the Windows app. Install Node.js, then double-click this file again.
  popd
  pause
  exit /b 1
)
if not exist "node_modules\.bin\electron-builder.cmd" (
  echo Installing the build tools...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Could not install the build tools. Install Node.js and try again.
    popd
    pause
    exit /b 1
  )
)
call npm run package:win
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" (
  echo Build failed with exit code %RESULT%.
) else (
  echo.
  echo Windows installer and portable app created in the dist folder.
)
popd
pause
exit /b %RESULT%
