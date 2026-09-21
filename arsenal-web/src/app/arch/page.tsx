import type { Metadata } from 'next';
import ArchGallery from './ArchGallery';
import { ARCH_VIEWS } from '@/lib/arch-views';

export const metadata: Metadata = {
  title: '架构图谱',
  description: `六大架构一图讲清：${ARCH_VIEWS.map((v) => v.name).join('、')}。从战略到落地，职责边界、关注重点与产出。`,
};

export default function ArchPage() {
  return <ArchGallery />;
}
