import type { Metadata, Viewport } from 'next';
import './globals.css';
import Shell from '@/components/Shell';
import { meta } from '@/lib/rules';

export const metadata: Metadata = {
  title: {
    default: `${meta.name} · v${meta.version}`,
    template: `%s · ${meta.name}`,
  },
  description:
    '个人 Java / Spring Boot 工程规范集。一份数据三种出口：人查、给 AI 用、拿代码验。',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0B0F0E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-canvas text-fg antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
