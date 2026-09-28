# 前端镜像：node 构建 + nginx 托管。
# 注意：compose 里 frontend 的 build.context 是项目根（..）——
# 本文件要同时引用 frontend/（源码）与 compose/frontend-nginx.conf（配置），
# 上下文改成 frontend/ 就 COPY 不到 nginx 配置。
FROM node:20-alpine AS build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

FROM nginx:1.27-alpine
COPY compose/frontend-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 80
