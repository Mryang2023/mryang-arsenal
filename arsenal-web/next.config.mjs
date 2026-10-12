/**
 * dev 与 build 各用各的构建目录。
 *
 * 起因：`next dev` 与 `next build` 默认共用 `.next`。只要在 dev server 运行期间
 * 跑过一次 build，dev 的 webpack-runtime 就会指向已被 build 覆写掉的 chunk，
 * 报 `Cannot find module './682.js'`，整个站直接 500 白屏 ——
 * 表面上像「功能没做」，实际只是两份产物在同一个目录里互相踩。
 *
 * next dev 强制 NODE_ENV=development，next build 强制 production，据此分流即可。
 */
const distDir = process.env.NODE_ENV === 'development' ? '.next-dev' : '.next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  // 静态导出：军火库要能脱离服务器活着（进 Git、进内网、直接分享）
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
