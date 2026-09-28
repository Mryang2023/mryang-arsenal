# {{appName}} 快速启动

> **初始账号：admin / admin123**（首次登录后请立即在「系统管理 → 用户管理」里修改 ——
> 种子幂等可重跑，重跑不会把改过的密码冲掉，但哈希对应的明文写在种子注释里，等于公开）

后端 {{artifactId}}（Spring Boot 3.2.x / JDK 17）+ 前端（Vue3 + Vite），
数据库 {{dbImage}} 由生成器注入（mysql:8.0.36 或 postgres:16-alpine）。

## 方式一：本机直跑（开发联调推荐）

前置：JDK 17、Maven 3.9+、Node 18+、Docker（只用来跑数据库）。

```bash
# 1. 只把数据库拉进容器（Windows 用 scripts\start-dev.bat）
bash scripts/start-dev.sh

# 2. 后端（新终端）
mvn spring-boot:run

# 3. 前端（新终端）
cd frontend && npm install && npm run dev
```

访问：前端 http://localhost:5173（Vite dev 端口），接口 http://localhost:8080/api/**。

## 方式二：演示模式（H2 内存库，零外部依赖）

仅登录与基础 CRUD 演示（若生成器装配了 demo 配置）：

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=demo
```

演示口径：H2 MODE=MySQL 兼容方言只保证登录与增删改查可跑，
不承诺生产语义（外键行为、时间精度等以真实库为准）。

## 方式三：全套容器（compose 一次起齐）

```bash
docker compose -f compose/docker-compose.yml up -d --build
```

访问：前端 http://localhost（nginx 托管 + /api 反代），后端 http://localhost:8080。

## 常见问题

- **端口占用（8080 / 80 / 3306 或 5432）**：
  Windows：`netstat -ano | findstr :8080`；macOS/Linux：`lsof -i :8080`。
  改 compose 的端口映射，或停掉占用进程。
- **数据库连不上**：先 `docker compose -f compose/docker-compose.yml ps` 看 db 是否
  healthy；首次启动要等镜像拉取；改过 root 密码必须同步改
  `SPRING_DATASOURCE_PASSWORD`（compose 与 application.yml 两处口径必须一致）。
- **登录 401**：确认请求头带 `Authorization: Bearer <token>`；
  `app.jwt.secret` 在 yml 与环境变量两处必须一致，不一致会验签失败。
- **忘记 admin 密码**：用另一个管理员账号重置；没有可用管理员时，
  直接改库（UPDATE sys_user SET password=<新 BCrypt 哈希> WHERE username='admin'），
  不要重跑种子 —— 幂等种子不会回写密码，重跑救不了忘密码。
