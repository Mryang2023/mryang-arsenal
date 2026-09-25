'use client';

import { useMemo, useState } from 'react';
import { lintFeatureFiles, selfCheckSummary, type SelfCheckResult } from '@/lib/cookbook-lint';
import { CHECK_LAYER_THEME, SEVERITY_THEME } from '@/lib/theme';
import type { Feature } from '@/lib/content-types';

/**
 * 方案页的「代码自证」徽标 —— 这套范例有没有过我们自己的规则引擎，一眼看见。
 *
 * ⚠ 不许把 `durationMs` 渲染进文案：引擎耗时在服务端渲染与浏览器水合两次跑出来不一样
 * （0ms / 1ms），会让 React 报 #425 水合文本不一致 —— 整个静态导出页的 console 全是红。
 * 非确定性的值只能给程序读，不能进 DOM。
 *
 * 三个数字全部由 `cookbook-lint` 现场算出，本文件**不含任何写死的计数**：
 * 规则数会涨、案例数会涨，今天写进文案里的条数明天就是句假话。
 * （`.verify/project-check.ts`【19】⑧ 会扫本文件，写死计数直接判红。）
 *
 * 展开区两件事：
 *   · 有违规 → 逐条列出 `文件:行号` 与命中片段（这是「闸门不是摆设」的证据）
 *   · 跳过清单 → 按层（AST / 语义 / 人工）如实列出未判的规则条数
 *     —— 宁可说「这条我检不了」，也不把没判的说成过了。
 */

const OLIVE = '#7FA650';

export default function BlueprintSelfCheck({ feature }: { feature: Feature }) {
  const [open, setOpen] = useState(false);
  const r: SelfCheckResult = useMemo(() => lintFeatureFiles(feature.files), [feature]);

  const clean = r.blocking.length === 0 && r.fileCount > 0;
  const accent = clean ? OLIVE : SEVERITY_THEME.NEVER.color;

  const nonBlocking = r.violations.filter((v) => v.severity !== 'MUST' && v.severity !== 'NEVER');

  return (
    <section className="panel overflow-hidden" data-selfcheck data-selfcheck-state={clean ? 'clean' : 'dirty'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-selfcheck-toggle
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surfaceHi"
      >
        <span
          className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[13px]"
          style={{ borderColor: accent + '4D', background: accent + '14', color: accent }}
        >
          {clean ? '✓' : '!'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-fg">{selfCheckSummary(r)}</span>
          <span className="mono mt-0.5 block text-2xs text-fgFaint">
            {r.fileCount} 个文件 / {r.totalLines} 行 · 规则池 {r.rulePool} 条 · files[].code
            只放 good 版，bad 示例在 pitfalls
          </span>
        </span>
        <span className="mono shrink-0 text-2xs text-fgMuted" data-selfcheck-expand>
          {open ? '收起' : '展开'} {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4" data-selfcheck-detail>
          {/* ── 命中明细 ───────────────────────────────── */}
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-fg">引擎判定明细</h3>
            <span className="mono text-2xs text-fgFaint">
              可执行 {r.executableRules} · 未判 {r.skippedRules} · 规则缺陷 {r.brokenRules}
            </span>
          </div>

          {r.violations.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-fgMuted">
              正则层 {r.executableRules} 条规则逐条扫过 {r.fileCount} 个文件，没有命中任何禁止/缺失写法。
            </p>
          ) : (
            <ul className="space-y-2">
              {r.violations.map((v, i) => {
                const st = SEVERITY_THEME[v.severity];
                return (
                  <li
                    key={`${v.ruleId}-${v.file}-${v.line}-${i}`}
                    className="rounded-md border border-line bg-surfaceHi px-3 py-2"
                    data-selfcheck-hit
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="mono rounded px-1.5 py-0.5 text-2xs"
                        style={{ background: st.soft, color: st.color }}
                      >
                        {st.code}
                      </span>
                      <span className="text-[13px] text-fg">{v.title}</span>
                      <span className="mono text-2xs text-fgFaint">{v.ruleId}</span>
                    </div>
                    <div className="mono mt-1 text-2xs text-fgMuted">
                      {v.file}:{v.line}:{v.column}
                    </div>
                    <pre className="mono mt-1 overflow-x-auto whitespace-pre-wrap break-all text-2xs text-fgFaint">
                      {v.snippet}
                    </pre>
                  </li>
                );
              })}
            </ul>
          )}

          {nonBlocking.length > 0 && r.blocking.length === 0 && (
            <p className="mt-2 text-2xs text-fgMuted">
              其中 {nonBlocking.length} 条是 SHOULD/MAY（不阻断交付），已如实列出。
            </p>
          )}

          {/* ── 如实披露：没判的那一层 ─────────────────── */}
          <div className="mt-4 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-fg">未判规则（如实披露）</h3>
            <span className="mono text-2xs text-fgFaint">共 {r.skippedRules} 条</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.skippedByLayer.map((s) => {
              const lt = CHECK_LAYER_THEME[s.layer];
              return (
                <span
                  key={s.layer}
                  className="mono rounded border px-2 py-0.5 text-2xs"
                  style={{ borderColor: lt.color + '40', color: lt.color }}
                  title={lt.desc}
                >
                  {lt.label} {s.count}
                </span>
              );
            })}
          </div>
          <details className="mt-2">
            <summary className="mono cursor-pointer text-2xs text-fgFaint hover:text-fgMuted">
              逐条查看（{r.skipped.length} 条）
            </summary>
            <ul className="mono mt-2 max-h-52 space-y-1 overflow-y-auto text-2xs text-fgFaint">
              {r.skipped.map((s) => (
                <li key={s.ruleId} data-selfcheck-skipped>
                  <span className="text-fgMuted">{s.ruleId}</span> · {s.title} —— {s.reason}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
