import type { Metadata } from 'next';
import QaLab from './QaLab';

export const metadata: Metadata = {
  title: '质检台',
  description:
    '给一个项目地址（本地目录 / https git），异步跑一轮深度审查：规则硬伤 + 范围圈定（整仓 / 严格局部 / 全量聚焦）+ 逐点优化方案 + 测试建议。',
};

export default function QaPage() {
  return <QaLab />;
}
