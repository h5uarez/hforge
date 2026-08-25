@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT=%~dp0"
set "FRONTEND_DIR=%ROOT%frontend"
set "API_DIR=%ROOT%api"
set "DATA_DIR=%ROOT%data-local"

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_npm

for /f "delims=" %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%V"
for /f "tokens=1 delims=." %%M in ("%NODE_VERSION%") do set "NODE_MAJOR=%%M"

if not defined NODE_MAJOR goto :invalid_node
if %NODE_MAJOR% LSS 22 goto :old_node

if not exist "%FRONTEND_DIR%\package.json" goto :invalid_root
if not exist "%API_DIR%\package.json" goto :invalid_root
if not exist "%ROOT%media\img\" goto :invalid_media
if not exist "%ROOT%media\gif\" goto :invalid_media

call :install_if_missing "frontend" "%FRONTEND_DIR%"
if errorlevel 1 goto :dependency_failure

call :install_if_missing "api" "%API_DIR%"
if errorlevel 1 goto :dependency_failure

if not exist "%DATA_DIR%\" mkdir "%DATA_DIR%"
if errorlevel 1 goto :data_failure

set "PORT=3000"
set "RP_ID=localhost"
set "ORIGIN=http://localhost:8080"
start "Hforge API" /D "%API_DIR%" "%ComSpec%" /k "npm start"
if errorlevel 1 goto :launch_failure

start "Hforge frontend" /D "%FRONTEND_DIR%" "%ComSpec%" /k "npm run dev -- --host 127.0.0.1 --port 8080 --open"
if errorlevel 1 goto :launch_failure

start "Hforge media" /D "%ROOT%" "%ComSpec%" /k "node scripts\serve-media.mjs"
if errorlevel 1 goto :launch_failure

echo.
echo Hforge local environment started.
echo Frontend: http://localhost:8080
echo API:      http://localhost:3000
echo Media:    internal server for /img and /gif on 127.0.0.1:8888
echo.
echo To stop it, close the "Hforge API", "Hforge frontend", and "Hforge media" windows.
echo This launcher does not stop pre-existing processes.
echo.
echo Press any key to close this launcher window.
pause >nul
endlocal
exit /b 0

:install_if_missing
set "COMPONENT=%~1"
set "COMPONENT_DIR=%~2"
if exist "%COMPONENT_DIR%\node_modules\" exit /b 0

echo Installing %COMPONENT% dependencies...
pushd "%COMPONENT_DIR%"
if errorlevel 1 exit /b 1
call npm ci
set "INSTALL_RESULT=%ERRORLEVEL%"
popd
if not "%INSTALL_RESULT%"=="0" exit /b 1
exit /b 0

:missing_node
echo ERROR: Node.js is required but was not found on PATH.
echo Install Node.js 22 or newer, then run this file again.
pause
exit /b 1

:missing_npm
echo ERROR: npm is required but was not found on PATH.
echo Install Node.js 22 or newer with npm, then run this file again.
pause
exit /b 1

:invalid_node
echo ERROR: Could not determine the installed Node.js version.
echo Install Node.js 22 or newer, then run this file again.
pause
exit /b 1

:old_node
echo ERROR: Node.js %NODE_VERSION% is too old for Hforge.
echo Node.js 22 or newer is required. Upgrade Node.js, then run this file again.
pause
exit /b 1

:invalid_root
echo ERROR: This file must remain in the Hforge repository root.
pause
exit /b 1

:invalid_media
echo ERROR: The media directories are missing:
echo %ROOT%media\img
echo %ROOT%media\gif
pause
exit /b 1

:dependency_failure
echo ERROR: Dependency installation failed. See the npm output above.
pause
exit /b 1

:data_failure
echo ERROR: Could not create the local data directory:
echo %DATA_DIR%
pause
exit /b 1

:launch_failure
echo ERROR: Could not open one of the Hforge service windows.
pause
exit /b 1
