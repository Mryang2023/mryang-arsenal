import type { Metadata } from 'next';
import StandardsConsole from './StandardsConsole';

export const metadata: Metadata = {
  title: '工程规范台',
  description:
    '多人开发同一个项目时的规范治理：今天该处理什么、谁认领、哪个模块在持续破规、什么时候到期、门禁接没接上。',
};

export default function StandardsPage() {
  return <StandardsConsole />;
}
