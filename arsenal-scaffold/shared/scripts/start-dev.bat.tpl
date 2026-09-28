@echo off
REM 开发联调脚本（Windows）：只把数据库拉进容器，后端/前端仍在本机跑。
REM 前置：Docker Desktop 已启动；本机装有 JDK 17、Maven 3.9+、Node 18+。
REM 数据库端口默认 3306（PostgreSQL 时生成器改为 5432 —— 本文件不含模板
REM 占位符，端口由生成器替换后写死，两种库各持一份口径，不会互相污染）。
REM 用法：scripts\start-dev.bat
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

set COMPOSE=compose\docker-compose.yml
set DB_PORT=3306

echo ==^> [1/3] 检查 Docker
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker 不可用：请先启动 Docker Desktop
    exit /b 1
)

echo ==^> [2/3] 启动数据库容器（首次拉镜像可能较慢）
docker compose -f %COMPOSE% up -d db

echo ==^> [3/3] 等待数据库端口就绪（%DB_PORT%）
set /a tries=0
:wait_db
netstat -ano | findstr ":%DB_PORT% " >nul 2>&1
if not errorlevel 1 goto db_ready
set /a tries+=1
if %tries% geq 60 (
    echo 数据库端口 %DB_PORT% 等待超时：docker compose -f %COMPOSE% logs db 查看原因
    exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait_db
:db_ready
echo.
echo 数据库已就绪。接下来两条命令（各开一个终端）：
echo   1^) 后端： mvn spring-boot:run
echo   2^) 前端： npm install ^&^& npm run dev
endlocal
