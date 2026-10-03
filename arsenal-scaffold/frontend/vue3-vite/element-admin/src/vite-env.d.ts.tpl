/// <reference types="vite/client" />

// Vite 只把 VITE_ 前缀的变量暴露给客户端代码；在这里声明才有类型。
interface ImportMetaEnv {
  /** 后端地址。留空 = 同源（开发走 vite 代理、生产走 nginx 反代），见 .env 内注释 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
