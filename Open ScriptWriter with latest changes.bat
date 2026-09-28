@echo off
setlocal
pushd "%~dp0"
where npm >NUL 2>NUL
if errorlevel 1 (
  echo Node.js is needed to open the latest source. Install Node.js, then double-click this file again.
  popd
  pause
  exit /b 1
)
if not exist "node_modules\.bin\electron.cmd" (
  echo Setting up ScriptWriter for first use...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Setup failed. ScriptWriter was not opened.
    popd
    pause
    exit /b 1
  )
)
echo Opening ScriptWriter from the current source files...
call npm start
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" (
  echo ScriptWriter could not open. Exit code: %RESULT%.
  pause
)
popd
exit /b %RESULT%
