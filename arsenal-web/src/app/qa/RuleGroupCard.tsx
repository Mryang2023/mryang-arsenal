'use client';

import { useState } from 'react';
import { type AutopsyFinding, type QaRuleGroup, type QaRuleSnapshot } from '@/lib/arsenal-api';
import SeverityBadge from '@/components/SeverityBadge';
import type { Severity } from '@/lib/types';
import FindingRow from './FindingRow';
import { PathCopy, SourceList, findingKey } from './FindingRow';

/**
 * 「按规则」聚合卡（质检台 Q2）。数据来自报告自带的 groupedByRule（后端 FindingGrouper 算的，
 * 前端不重算聚合——重算就是第二套口径）。规则快照从平铺静态 findings 的 rule? 里按 ruleId 取
 * （同一 ruleId = 检查时点的同一条规则，同源不算第二真相）。
 *
 * 交互：违反 N 处的卡展开先给「这条规则怎么了」（出处 + 后果），再给逐条路径清单——
 * 改代码按类改，先懂规则再动文件。count=1 且能在平铺里找到原文时回退成完整 FindingRow（六段可展开）。
 */
export default function RuleGroupCard({
  group,
  ruleLookup,
  flatIndex,
}: {
  group: QaRuleGroup;
  ruleLookup: Map<string, QaRuleSnapshot>;
  flatIndex: Map<string, AutopsyFinding>;
}) {
  const [open, setOpen] = useState(false);
  const rule = ruleLookup.get(group.ruleId);
  const semantic = group.tier === 'semantic';

  // count=1 回退平铺：聚合 items 只有 file/line，找到平铺原文才有六段详情；找不到就老实走路径清单
  const solo = group.count === 1 && !semantic
    ? flatIndex.get(findingKey(group.ruleId, group.items[0]?.file ?? '', group.items[0]?.line ?? 0))
    : undefined;

  return (
    <li className="rounded border border-line px-2.5 py-2">
      <button type="button" onClick={() => setOpen((s) => !s)} className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left">
        <SeverityBadge severity={group.severity as Severity} size="sm" />
        {semantic && (
          <span className="mono rounded border border-line px-1 text-[9px] text-fgFaint">语义</span>
        )}
        <span className="text-[11px] text-fg">{group.title}</span>
        <span className="mono text-[10px]" style={{ color: '#E5484D' }}>
          违反 {group.count} 处
        </span>
        {group.collapsedTotal != null && group.collapsedTotal > 0 && (
          <span className="mono text-[9.5px] text-fgFaint">（引擎折叠重复命中 {group.collapsedTotal}，只披露不计入）</span>
        )}
        <span className="mono ml-auto text-[10px] text-fgMuted">{open ? '收起' : '展开'}</span>
      </button>
      <p className="mono mt-0.5 break-all text-[10px] text-fgFaint">
        <a
          href={`/rules/${encodeURIComponent(group.ruleId)}`}
          target="_blank"
          rel="noreferrer"
          className="text-brass underline decoration-dotted"
        >
          {group.ruleId}
        </a>
        {!semantic && group.items[0]?.tier && (
          <span className="ml-1.5">
            平铺档位：
            {Array.from(new Set<string>(group.items.map((it) => it.tier as string).filter(Boolean))).join(' / ')}
          </span>
        )}
      </p>

      {open && (
        <div className="mt-2 space-y-2 rounded border border-line bg-surface/40 px-2.5 py-2">
          {/* 这条规则怎么了：出处 + 后果（来自检查时点快照；没有就明说） */}
          {rule ? (
            <>
              <section>
                <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">依据出处</p>
                <div className="mt-0.5">
                  <SourceList sources={rule.sources} />
                </div>
              </section>
              {rule.impact && (
                <section>
                  <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">不修的后果</p>
                  <p className="mt-0.5 text-[10.5px] leading-[16px]" style={{ color: '#E5484D' }}>{rule.impact}</p>
                  <p className="mt-0.5 text-[9.5px] text-fgFaint">（出自规则库 impact 字段）</p>
                </section>
              )}
            </>
          ) : (
            <p className="text-[10.5px] leading-[16px] text-fgFaint">
              这份报告没带这组 finding 的规则快照 —— 出处与后果请到「查看规则完整页」看现行版本。
            </p>
          )}

          {/* 逐条路径：static 组带平铺档位徽标；semantic 组不带（它的档位在平铺语义区） */}
          <section>
            <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">
              违反位置（{group.items.length} 条 · 卡内按文件排序）
            </p>
            {solo ? (
              <p className="mt-1 text-[10px] text-fgFaint">单条违反，完整详情走平铺那条（六段可展开）：</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {[...group.items]
                  .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
                  .map((it, i) => (
                    <li key={`gi-${i}`} className="flex flex-wrap items-center gap-1.5">
                      {it.tier && (
                        <span className="mono rounded border border-line px-1 text-[9px] text-fgFaint">{it.tier}</span>
                      )}
                      <PathCopy file={it.file} line={it.line} />
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* count=1 的回退详情（点卡片展开区不重复渲染） */}
      {open && solo && (
        <ul className="mt-1.5 space-y-1.5">
          <SoloDetail finding={solo} />
        </ul>
      )}
    </li>
  );
}

/** 单条回退：复用 FindingRow 的行组件（同源渲染，六段结构只维护一份），用户再点一次展开 */
function SoloDetail({ finding }: { finding: AutopsyFinding }) {
  const [open, setOpen] = useState(false);
  return <FindingRow v={finding} open={open} toggle={() => setOpen((s) => !s)} />;
}
