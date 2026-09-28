# 全套容器编排：db + backend + frontend 一次起齐。
# db 镜像由生成器按数据库选型注入 {{dbImage}}（mysql:8.0.36 或 postgres:16-alpine）；
# 两种数据库的 env/healthcheck/端口各有一份口径，切换只动 db 与 backend 两段，
# 前后端两段一字不改 —— 混着写迟早把「演示库」连到「开发库」。
#
# 用法：docker compose -f compose/docker-compose.yml up -d --build
# 口径与 scripts/start-dev.sh.tpl 一致：脚本只起 db，本文件起全套。
name: {{appName}}

services:
  db:
    image: {{dbImage}}
    container_name: {{appName}}-db
    restart: unless-stopped
    # ---- MySQL（{{dbImage}} = mysql:8.0.36 时启用）----
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: {{appName}}
      TZ: Asia/Shanghai
    ports:
      - "3306:3306"
    volumes:
      - db-data:/var/lib/mysql
      # 建表与种子进容器的初始化目录：首次启动自动执行（重跑由脚本幂等保证）
      - ./../sql/mysql:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -proot"]
      interval: 5s
      timeout: 3s
      retries: 30
    # ---- PostgreSQL（{{dbImage}} = postgres:16-alpine 时换成下面这段）----
    # environment:
    #   POSTGRES_USER: postgres
    #   POSTGRES_PASSWORD: root
    #   POSTGRES_DB: {{appName}}
    #   TZ: Asia/Shanghai
    # ports:
    #   - "5432:5432"
    # volumes:
    #   - db-data:/var/lib/postgresql/data
    #   - ./../sql/postgres:/docker-entrypoint-initdb.d:ro
    # healthcheck:
    #   test: ["CMD-SHELL", "pg_isready -U postgres -d {{appName}}"]
    #   interval: 5s
    #   timeout: 3s
    #   retries: 30

  backend:
    build:
      context: ../backend
      dockerfile: Dockerfile
    container_name: {{appName}}-backend
    restart: unless-stopped
    environment:
      # 变量名与 application.yml 的键一一对应（Spring 松散绑定）：
      #   SPRING_DATASOURCE_URL  -> spring.datasource.url
      #   APP_JWT_SECRET         -> app.jwt.secret（生产必须换掉默认值）
      SPRING_DATASOURCE_URL: jdbc:mysql://db:3306/{{appName}}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
      SPRING_DATASOURCE_USERNAME: root
      SPRING_DATASOURCE_PASSWORD: root
      APP_JWT_SECRET: ${APP_JWT_SECRET:-change-me-in-production-0123456789abcdef}
      TZ: Asia/Shanghai
      # ---- PostgreSQL 时替换两行（其余不动）----
      # SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/{{appName}}
      # SPRING_DATASOURCE_USERNAME: postgres
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8080:8080"

  frontend:
    build:
      context: ..
      dockerfile: compose/frontend.Dockerfile
    container_name: {{appName}}-frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "80:80"

volumes:
  db-data:
