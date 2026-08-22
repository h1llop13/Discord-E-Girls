@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Discord E-Girls Bot

rem A file opened from Explorer can have an unrelated working directory.
cd /d "%~dp0"

rem Add the standard Node.js and Docker Desktop CLI locations. Current Docker
rem versions recommend a per-user installation, while older installations use
rem Program Files.
set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\DockerDesktop\resources\bin;%ProgramFiles%\Docker\Docker\resources\bin;%PATH%"

echo.
echo Discord E-Girls Bot - локальный запуск Windows
echo Папка: %CD%

if not exist ".env" (
  set "ERROR_MESSAGE=Не найден файл .env рядом с файлом запуска."
  goto fail
)

if not exist "package.json" (
  set "ERROR_MESSAGE=Файл запуска должен находиться в корне проекта."
  goto fail
)
if not exist "package-lock.json" (
  set "ERROR_MESSAGE=Не найден package-lock.json."
  goto fail
)
if not exist "compose.yaml" (
  set "ERROR_MESSAGE=Не найден compose.yaml."
  goto fail
)

where node >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Node.js не найден. Установите Node.js 22 или новее с nodejs.org."
  goto fail
)

where npm >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=npm не найден рядом с Node.js."
  goto fail
)

where docker >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Docker не найден. Установите Docker Desktop для Windows."
  goto fail
)

set "NODE_MAJOR="
for /f "usebackq delims=" %%V in (`node -p "Number(process.versions.node.split('.')[0])" 2^>nul`) do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR (
  set "ERROR_MESSAGE=Не удалось определить версию Node.js."
  goto fail
)
if %NODE_MAJOR% LSS 22 (
  set "ERROR_MESSAGE=Нужен Node.js 22 или новее."
  goto fail
)

docker compose version >nul 2>&1
if errorlevel 1 (
  set "ERROR_MESSAGE=Команда Docker Compose недоступна. Переустановите Docker Desktop."
  goto fail
)

docker info >nul 2>&1
if not errorlevel 1 goto docker_ready

echo.
echo [^>] Docker Desktop не запущен. Открываю его и жду готовности...
if exist "%LocalAppData%\Programs\DockerDesktop\Docker Desktop.exe" (
  start "" "%LocalAppData%\Programs\DockerDesktop\Docker Desktop.exe"
) else if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else if exist "%LocalAppData%\Docker\Docker Desktop.exe" (
  start "" "%LocalAppData%\Docker\Docker Desktop.exe"
) else (
  set "ERROR_MESSAGE=Не удалось найти Docker Desktop.exe. Откройте Docker Desktop вручную."
  goto fail
)

set /a DOCKER_TRIES=0
:wait_for_docker
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a DOCKER_TRIES+=1
if %DOCKER_TRIES% GEQ 60 goto docker_timeout
timeout /t 2 /nobreak >nul
goto wait_for_docker

:docker_timeout
set "ERROR_MESSAGE=Docker Desktop не запустился за 2 минуты. Проверьте его окно и повторите запуск."
goto fail

:docker_ready
echo.
echo [^>] Запуск PostgreSQL в Docker
docker compose up -d
if errorlevel 1 (
  set "ERROR_MESSAGE=Не удалось запустить PostgreSQL в Docker."
  goto fail
)

echo.
echo [^>] Ожидание PostgreSQL...
set /a DATABASE_TRIES=0
:wait_for_database
docker compose exec -T postgres pg_isready -U discord_bot -d discord_bot >nul 2>&1
if not errorlevel 1 goto database_ready
set /a DATABASE_TRIES+=1
if %DATABASE_TRIES% GEQ 30 goto database_timeout
timeout /t 1 /nobreak >nul
goto wait_for_database

:database_timeout
set "ERROR_MESSAGE=PostgreSQL не стал доступен за 30 секунд."
goto fail

:database_ready
echo [OK] PostgreSQL готов.

if not exist "node_modules" goto install_dependencies
if not exist "node_modules\.package-lock.json" goto install_dependencies
powershell.exe -NoProfile -Command "if ((Get-Item 'package-lock.json').LastWriteTimeUtc -gt (Get-Item 'node_modules/.package-lock.json').LastWriteTimeUtc) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 goto install_dependencies
echo.
echo [OK] Зависимости уже установлены.
goto dependencies_ready

:install_dependencies
echo.
echo [^>] Установка зависимостей
call npm ci
if errorlevel 1 (
  set "ERROR_MESSAGE=Не удалось установить npm-зависимости."
  goto fail
)

:dependencies_ready
echo.
echo [^>] Применение миграций базы
call npm run db:migrate
if errorlevel 1 (
  set "ERROR_MESSAGE=Не удалось применить миграции базы."
  goto fail
)

echo.
echo [^>] Сборка проекта
call npm run build
if errorlevel 1 (
  set "ERROR_MESSAGE=Не удалось собрать проект."
  goto fail
)

echo.
echo [OK] Все готово. Запускаю бота.
echo Для остановки нажмите Control + C в этом окне.
echo.

call npm start
set "BOT_STATUS=%ERRORLEVEL%"

echo.
if "%BOT_STATUS%"=="0" (
  echo [STOP] Бот остановлен. PostgreSQL остался запущенным в Docker.
) else (
  echo [ERROR] Бот завершился с кодом %BOT_STATUS%.
)
echo.
pause
exit /b %BOT_STATUS%

:fail
echo.
echo [ERROR] %ERROR_MESSAGE%
echo.
pause
exit /b 1
