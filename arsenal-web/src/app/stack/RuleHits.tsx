'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { StackPicks } from '@/lib/content-types';
import { rules } from '@/lib/rules';
import { stackKeysFor } from '@/lib/rule-hits';
import { SEVERITY_ORDER, SEVERITY_THEME } from '@/lib/theme';

/**
 * S3-4 规则联动：装配台右栏的「这套组合牵动哪些规则」。
 *
 * 展示取舍（为什么不全列）——基底/骨架层 key（java-17 / spring-boot-3 /
 * maven / git）对**所有**组合恒定命中，全量 60+ 条会把结论区淹没、且换件
 * 时纹丝不动毫无信息量。所以：
 *   · 逐条列出 = 「选型层」key（mysql / jdbc / 将来的 redis…）命中的规则
 *     —— 这部分随换件实时增减，正是验收要求的「换件后命中列表实时变」；
 *   · 恒定命中收成一行计数 + 去规则库的入口，数字实时算，不写死。
 * 规则 id 全部来自 rules.json（/rules/<id> 真实存在），不发明。
 */
export default function RuleHits({ picks, baseId }: { picks: StackPicks; baseId: string }) {
  const { specific, generalCount } = useMemo(() => {
    const keys = new Set(stackKeysFor(picks, baseId));
    const specificKeys = new Set([...keys].filter((k) => !isGeneralKey(k)));
    const generalKeys = new Set([...keys].filter(isGeneralKey));
    const specific = rules
      .filter((r) => (r.appliesTo?.stack ?? []).some((k) => specificKeys.has(k)))
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          a.id.localeCompare(b.id)
      );
    const generalCount = rules.filter((r) =>
      (r.appliesTo?.stack ?? []).some((k) => generalKeys.has(k))
    ).length;
    return { specific, generalCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, baseId]);

  return (
    <section data-rule-hits="" className="border-t border-line px-1 pb-1 pt-3">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span className="mono text-[10px] uppercase tracking-wider text-fgMuted">规则联动</span>
        <span className="text-[10px] text-fgFaint">这套组合牵动的规则，换件实时变</span>
      </div>

      {specific.length === 0 ? (
        <p className="px-1 text-[10px] leading-[15px] text-fgFaint">
          当前组合没有牵动随选型变化的规则。
        </p>
      ) : (
        <ul className="space-y-1">
          {specific.map((r) => {
            const sev = SEVERITY_THEME[r.severity];
            return (
              <li key={r.id}>
                <Link
                  href={`/rules/${r.id}`}
                  data-rule-hit=""
                  className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 transition-colors hover:border-lineHi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass"
                  title={`${sev.label} · ${r.category} —— 点击看完整规则（bad / good 示例与检查器）`}
                >
                  <span
                    className="mono shrink-0 rounded-sm px-1 text-[10px] leading-[15px]"
                    style={{ color: sev.color, background: sev.soft }}
                  >
                    {sev.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] leading-[16px] text-fgMuted">
                    {r.title}
                  </span>
                  <span className="mono shrink-0 text-[10px] text-fgFaint">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {generalCount > 0 && (
        <p className="mt-1.5 px-1 text-[10px] leading-[15px] text-fgFaint">
          另有 Java 17 / Spring Boot 3.x / Maven / Git 的 {generalCount} 条骨架与工程规范{' '}
          <Link href="/rules" className="text-brass hover:underline">
            去规则库 →
          </Link>
        </p>
      )}
    </section>
  );
}

function isGeneralKey(k: string): boolean {
  return k === 'java-17' || k === 'spring-boot-3' || k === 'maven' || k === 'git';
}
