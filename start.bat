@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ТЕРМИНАЛ: САМОСБОР // LOCAL SERVER
color 0A

echo ========================================================
echo   ТЕРМИНАЛ: САМОСБОР (GIGAHOUSE-OS v.19.84)
echo   ЗАПУСК ЛОКАЛЬНОГО СЕРВЕРА...
echo ========================================================
echo.

:: Проверка наличия Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ОШИБКА]: Node.js не найден в системе!
    echo Установите Node.js с официального сайта: https://nodejs.org/
    echo.
    pause
    exit /b
)

:: Проверка зависимостей
if not exist "node_modules" (
    echo [ИНФО]: Папка node_modules не найдена. Установка зависимостей npm...
    call npm install
    echo.
)

:: Автоматическое открытие браузера через 2 секунды в фоне
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo [СЕРВЕР]: Игра открывается в браузере: http://localhost:3000
echo [СЕРВЕР]: Для остановки сервера закройте это окно (или Ctrl+C).
echo.
echo ========================================================
echo.

node server.js

if %errorlevel% neq 0 (
    echo.
    color 0C
    echo [СЕРВЕР]: Сервер завершил работу с кодом ошибки.
    pause
)