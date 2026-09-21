import type { Metadata } from 'next';
import ArchifyLab from './ArchifyLab';
import { ARCHIFY_SHAPE_FIELDS } from '@/lib/archify-ir';

export const metadata: Metadata = {
  title: 'Archify 出图台',
  description:
    '把任意一份架构 IR 交给通用绘图器渲染成合格交付图：本地先预检，再走后端出图，拿到 HTML 与逐条构图诊断。',
};

export default function ArchifyPage() {
  // 构建期读一次字段清单：schema 写坏时构建直接失败，而不是页面白屏
  void ARCHIFY_SHAPE_FIELDS.length;
  return <ArchifyLab />;
}
