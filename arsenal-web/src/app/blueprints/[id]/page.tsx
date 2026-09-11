import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { features, getFeature } from '@/lib/cookbook';
import BlueprintView from './BlueprintView';

/** 构建期把 4 个蓝图全部预渲染成静态页 —— 蓝图内容变动频率低，没必要运行时渲染。 */
export function generateStaticParams() {
  return features.map((f) => ({ id: f.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const feature = getFeature(params.id);
  if (!feature) return { title: '蓝图不存在' };
  return {
    title: `${feature.name} · 蓝图`,
    description: `${feature.subtitle}｜${feature.fileCount} 个文件、${feature.lines} 行代码、${feature.highlightCount} 条要点备注。`,
  };
}

export default function BlueprintPage({ params }: { params: { id: string } }) {
  const feature = getFeature(params.id);
  if (!feature) notFound();
  return <BlueprintView feature={feature} />;
}
