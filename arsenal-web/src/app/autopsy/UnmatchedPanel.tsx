'use client';

import { useState } from 'react';
import { autopsyCoverage, autopsyUnmatched, type AutopsyCoverage } from '@/lib/autopsy-data';
import type { ProjectFacts } from '@/lib/facts-arch';

/**
 * 未识别依赖清单。
 *
 * 这是解剖台最有价值的一块：**「没认出来」必须显式列出**（本仓铁律：
 * 命中必带证据，没命中的进 unmatched，不许静默丢弃）。一条都没有的时候也要说
 * 「0 条」并解释为什么 —— 「没有要提示的」和「没有没识别的」在页面上长得一模一样，
 * 而前者可能是扫描根本没读到依赖文件。
 */
export default function UnmatchedPanel({ facts }: { facts: ProjectFacts }) {
  const items = autopsyUnmatched(facts);
  const cov: AutopsyCoverage = autopsyCoverage(facts);
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, 12);

  return (
    <div className="rounded border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-[11.5px] font-semibold text-fg">未识别依赖</span>
        <span className="mono" style={{ color: items.length ? '#E5A33D' : '#56C596' }}>
          {items.length} 个坐标
        </span>
        <span className="text-fgMuted">
          依赖 {cov.depCount} 个 · 识别率 {(cov.coverage * 100).toFixed(0)}%
        </span>
        <span className="text-fgFaint">
          映射表 {cov.ruleCount} 条（{cov.ruleOnCanvas} 条上画布）
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">
          这个项目的每个依赖坐标都在映射表里 —— 没有要补的。
          {cov.depCount === 0 && (
            <span style={{ color: '#E5A33D' }}>
              {' '}
              但依赖数也是 0：没读到构建文件（pom.xml / build.gradle / package.json）时，
              「0 条未识别」不代表全认得，而是一个依赖都没扫到 —— 这种时候结论不可信。
            </span>
          )}
        </p>
      ) : (
        <>
          <ul className="mt-1.5 space-y-1">
            {shown.map((u) => (
              <li key={`${u.group}:${u.artifact}`} className="text-[10.5px] leading-[16px]">
                <span className="mono" style={{ color: '#E5A33D' }}>
                  {u.coord}
                </span>
                <span className="ml-1.5 text-fgFaint">×{u.count}</span>
                {/* 证据：文件路径 + 行号。没有证据必须明说，不许省略 ——
                    省略之后「没解析到出处」和「这条没有出处」就分不开了 */}
                {u.evidence.length > 0 ? (
                  <span className="mono ml-1.5 text-fgMuted">
                    ←{' '}
                    {u.evidence
                      // npm 依赖（package.json）后端给的行号是 0 —— 写「:0」像 bug，
                      // 写「无行号」才是事实：路径有，行没有。
                      .map((e) => (e.line > 0 ? `${e.path}:${e.line}` : `${e.path}（无行号）`))
                      .join('、')}
                  </span>
                ) : (
                  <span className="ml-1.5 text-fgFaint">← 后端没给出处（无 evidence）</span>
                )}
              </li>
            ))}
          </ul>
          {items.length > 12 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-[10px] text-fgFaint underline"
            >
              {open ? '收起' : `还有 ${items.length - 12} 个`}
            </button>
          )}
          <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
            这些坐标不在映射表里，因此不进部署图、也不进选型 —— 要补就在{' '}
            <span className="mono">tools/content/scan_rules.py</span> 加一条，
            改完跑 <span className="mono">python tools/build-content.py</span> 与 sync。
          </p>
        </>
      )}
    </div>
  );
}
