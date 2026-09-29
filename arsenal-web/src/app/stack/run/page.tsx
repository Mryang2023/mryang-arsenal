import type { Metadata } from 'next';
import StackRun from '../StackRun';

export const metadata: Metadata = {
  title: '运行与部署',
  description:
    '装配台四页的第三页：交付与运行 → 部署形态。运行环境 / 入口 / 编排 / 制品库 / CI/CD / 监控 / 密钥 / 日志在这里一处表态，再逐个给已装上的零件定副本数 —— 副本数写进 K8s / Compose 清单，不是一句展示文字。',
};

export default function StackRunPage() {
  return <StackRun />;
}
