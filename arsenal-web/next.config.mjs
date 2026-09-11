/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：军火库要能脱离服务器活着（进 Git、进内网、直接分享）
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
