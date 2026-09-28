#!/usr/bin/env bash
# 开发联调脚本：只把数据库拉进容器，后端/前端仍在本机跑 —— 断点与热加载都留着。
#
# 前置：Docker 已启动；本机装有 JDK 17、Maven 3.9+、Node 18+。
# 数据库端口默认 3306（PostgreSQL 选型时生成器会改成 5432 —— 本文件不含
# 模板占位符，端口由生成器替换后写死，避免两种库各改一份口径对不上）。
#
# 用法：bash scripts/start-dev.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # 脚本放 scripts/ 下，回到项目根找 compose

COMPOSE="compose/docker-compose.yml"
DB_PORT=3306   # PostgreSQL 时生成器改为 5432

echo "==> [1/3] 检查 Docker"
if ! docker info >/dev/null 2>&1; then
    echo "Docker 不可用：请先启动 Docker Desktop（或 dockerd）"
    exit 1
fi

echo "==> [2/3] 启动数据库容器（首次拉镜像可能较慢）"
docker compose -f "$COMPOSE" up -d db

echo "==> [3/3] 等待数据库端口就绪（$DB_PORT）"
ready=0
for i in $(seq 1 60); do
    # 用 /dev/tcp 探端口而不是进容器跑 mysqladmin/pg_isready ——
    # 两种数据库各持一份探测命令迟早对不上；端口探测对两种库都成立
    if (exec 3<>"/dev/tcp/127.0.0.1/$DB_PORT") 2>/dev/null; then
        exec 3>&- 3<&- || true
        ready=1
        break
    fi
    sleep 2
done
if [ "$ready" != "1" ]; then
    echo "数据库端口 $DB_PORT 等待超时：docker compose -f $COMPOSE logs db 查看原因"
    exit 1
fi

echo ""
echo "数据库已就绪。接下来两条命令（各开一个终端）："
echo "  1) 后端： mvn spring-boot:run"
echo "  2) 前端： npm install && npm run dev"
