import type { Metadata } from 'next';
import { casesMeta, casesStats } from '@/lib/case-cases';
import L1CaseIndex from './L1CaseIndex';

export const metadata: Metadata = {
  title: '场景案例库',
  description:
    '说出问题、调参数，直接给出建表 DDL 与生产级 Java。每个代码切片带命中条件，未命中的必须写明原因，参数组合矛盾会在顶部标黄。',
};

export default function CasesPage() {
  // 构建期读一次统计：cases.json 缺字段时构建直接失败，而不是页面白屏
  void casesMeta.count;
  void casesStats.slices;
  // L1 只挑症状（不出现参数与代码）—— 拧参数在 /cases/[caseId]，拿施工图在再下一层
  return <L1CaseIndex />;
}
