import type { StackPicks } from '@/lib/content-types';
import { baseById } from '@/lib/stack';
import { rules } from '@/lib/rules';
import { SEVERITY_ORDER } from '@/lib/theme';
import type { Severity } from '@/lib/types';

/**
 * S3-4 规则联动：装配台组合 → 规则库的技术 key。
 *
 * `appliesTo.stack` 的值域是规则库自己的词汇（实测 2026-09 全 69 条：
 * java-17 / spring-boot-3 / maven / git / mysql / jdbc，无空白）。本文件
 * 只做「组合 → key」的映射，命中判定 = key 有交集；**不发明规则库里没有
 * 的条件** —— 计划里举例的「选了 Redis 无超时」这类条件规则，规则库当前
 * 并不存在，等真有 appliesTo 写着 redis 的规则进来，选型层映射再加一行。
 *
 * ── 基底层（GENERAL_STACK_KEYS：只依赖基底/骨架，对所有组合恒定）──
 *   java-17       ↔ 基底 `java === '17+'`（6 个基底的实测值全是 17+）
 *   spring-boot-3 ↔ 基底 `line` 以 `'3.'` 开头（boot32/boot35 命中；
 *                    Quarkus 的 line='3' 无点、Boot 4.x、Micronaut 4 精确排除）
 *   maven / git   ↔ 骨架恒含（project 结构树里有 pom.xml 与 .gitignore）
 *
 * ── 选型层（随换件实时变，装配台上逐条展示的就是它们）──
 *   mysql ↔ picks.database === 'mysql'（技术 key 与选项 id 同名直配）
 *   jdbc  ↔ database 选了真数据库（mysql/postgres 都走 JDBC 生态 → DATA-SQL-001）
 */
export const GENERAL_STACK_KEYS = ['java-17', 'spring-boot-3', 'maven', 'git'] as const;

/** 当前组合命中的技术 key。骨架恒含 maven/git；基底命中才加 Java/Spring key。 */
export function stackKeysFor(picks: StackPicks, baseId: string): string[] {
  const keys = new Set<string>(['maven', 'git']);
  const base = baseById.get(baseId);
  if (base && base.java === '17+') keys.add('java-17');
  if (base && base.line.startsWith('3.')) keys.add('spring-boot-3');
  const db = picks['database'] ?? '';
  if (db === 'mysql') keys.add('mysql');
  if (db && db !== 'none') keys.add('jdbc');
  return [...keys];
}

export interface RuleHit {
  id: string;
  title: string;
  severity: Severity;
  category: string;
}

/** 全量命中（按严重度 → id 排序）。展示层的取舍在 RuleHits 组件里做。 */
export function hitRules(picks: StackPicks, baseId: string): RuleHit[] {
  const keys = new Set(stackKeysFor(picks, baseId));
  return rules
    .filter((r) => (r.appliesTo?.stack ?? []).some((k) => keys.has(k)))
    .map((r) => ({ id: r.id, title: r.title, severity: r.severity, category: r.category }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        a.id.localeCompare(b.id)
    );
}
