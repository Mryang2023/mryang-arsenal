import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Vite 配置。
 * - @ 别名指向 src，所有业务代码禁止写 ../.. 相对路径翻山。
 * - 开发期把 /api 代理到后端（changeOrigin 会把 Host 改写为目标站，
 *   少数按 Host 校验的后端不写这个会 403/404）。
 *   代理与 .env.development 的 VITE_API_BASE= 配套：开发期 axios 走同源
 *   相对路径 /api，由这里转发，浏览器侧没有跨域问题。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: '{{backendBaseUrl}}',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
