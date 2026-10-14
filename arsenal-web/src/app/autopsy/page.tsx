import type { Metadata } from 'next';
import AutopsyLab from './AutopsyLab';

export const metadata: Metadata = {
  title: '项目侦察',
  description:
    '给一个项目地址（本地目录 / https git / zip），一键侦察出技术栈部署图、应用分层图与未识别依赖清单 —— 每条结论都带文件与行号。',
};

export default function AutopsyPage() {
  return <AutopsyLab />;
}
