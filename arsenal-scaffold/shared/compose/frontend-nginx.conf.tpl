# 前端静态托管 + API 反代（frontend 容器内的 nginx 配置）。
# /api 转发到 backend 容器（compose 网络内的服务名）：
# proxy_pass 不带末尾斜杠 —— /api/ 前缀原样透传，后端控制器本来就挂在 /api/**，
# 若写成 http://backend:8080/ 会把前缀剥掉，所有接口 404。
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # history 路由兜底：刷新 /system/users 不能 404
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 指纹资源长缓存；index.html 不缓存 —— 发版立即生效，不用教用户强刷
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
