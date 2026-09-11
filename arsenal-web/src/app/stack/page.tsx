import type { Metadata } from 'next';
import StackComposer from './StackComposer';
import { lanes, nodeArch } from '@/lib/arch';
import { dimensions, stack } from '@/lib/stack';

export const metadata: Metadata = {
  title: '架构装配台',
  description: `${dimensions.length} 个模块摆成一张 ${lanes.length} 层的架构图，自由拼装。每个模块声明它提供什么能力、需要什么能力，缺了必需零件会直接告诉你跑不起来。`,
};

export default function StackPage() {
  // 引用一次，确保数据文件在构建期被读取（缺失时构建直接失败，而不是运行时白屏）
  void stack.version;
  void lanes.length;
  void Object.keys(nodeArch).length;
  return <StackComposer />;
}
