import type { Metadata } from 'next';
import RulesBrowser from './RulesBrowser';
import { liveStats } from '@/lib/rules';

export const metadata: Metadata = {
  title: '规则库',
  description: `${liveStats.total} 条 Java / Spring Boot 工程规范，全部可溯源到行业基准。`,
};

export default function RulesPage() {
  return <RulesBrowser />;
}
