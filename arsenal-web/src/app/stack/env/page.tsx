import type { Metadata } from 'next';
import StackEnv from '../StackEnv';
import { dimensions } from '@/lib/stack';

export const metadata: Metadata = {
  title: '环境与模块',
  description: `装配台四页的第二页：前端技术栈 → 环境与连接 → 功能模块。${dimensions.length} 维代码架构在「选型台」已经定完，这一页只回答它连哪个库、带哪些现成功能模块 —— 连接信息直接烘进导出包。`,
};

export default function StackEnvPage() {
  return <StackEnv />;
}
