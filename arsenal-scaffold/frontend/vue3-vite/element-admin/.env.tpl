# 环境变量只在构建期被 Vite 替换进产物（VITE_ 前缀才会暴露给客户端代码）。
# 留空 = 走同源：开发期由 vite.config.ts 的 /api 代理转发，生产由 nginx 反代 ——
# 两边都不需要 CORS。只有绕过代理直连后端时才填后端地址（如 http://{{backendBaseUrl}} 去掉路径后的主机部分）。
# 后端默认地址：{{backendBaseUrl}}
VITE_API_BASE=
