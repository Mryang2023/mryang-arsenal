import type { Metadata } from 'next';
import ExportStudio from './ExportStudio';

export const metadata: Metadata = {
  title: '导出中心',
  description: '把规则集编译成 System Prompt / .cursorrules / CLAUDE.md / MCP 配置，直接喂给 AI。',
};

export default function ExportPage() {
  return <ExportStudio />;
}
