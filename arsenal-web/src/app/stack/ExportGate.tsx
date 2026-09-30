'use client';

import { useMemo } from 'react';
import { TONE } from './palette';
import type { LintCheck, LintViolation } from '@/lib/export-lint';

/**
 * 导出预检闸（交付中心首屏）。
 *
 * 为什么把它单独抽出来、并且放在交付中心的第一屏：
 * 09-29 三轮导出事故的共性不是「算错了」，而是**问题在最后一步才露面** ——
 * 用户走完十步、按下导出，才被告知这份包跑不起来。闸门原本藏在双包面板
 * 里（滚过一屏才看得见），等于把「能不能交付」这个第一问题降到了页面中段。
 * 现在它独立于「交付预览 / 组合产物」的版面切换：两个版面第一屏都在，
 * 红绿两态一眼可见。
 *
 * ⚠️ 本组件**只做展示**，一次 lint 都不自己算：
 * violations 由调用方（StackDelivery）从 `plan.violations` 与
 * `artifacts.violations` 传进来，两者的计算逻辑在 `src/lib/export-lint.ts`，
 * 本文件一行都不碰。同理，**这里绝不能抛异常** —— 渲染路径抛错会整页白屏
 * （比「导出被拦」糟得多），所以全部走 props 驱动的条件渲染。
 *
 * 为什么按「包」分行而不是只给一个总数：两份包各自独立预检 ——
 * 组合产物包被拦不代表双包也被拦。混成一个数字会让「其实能下载的那份包」
 * 跟着一起被误判成不可用（拒发一份好包，比多报一条问题更伤）。
 */

export interface GateScope {
  id: string;
  /** 这份包叫什么（人话，带步骤号，方便回台上找） */
  label: string;
  /** 这份包的文件数 —— 绿态下说明「通过了多少文件」 */
  files: number;
  violations: LintViolation[];
}

/** 五类检查的人话标签（与 export-lint.ts 的 LintCheck 一一对应，加类必须加这里） */
const CHECK_LABEL: Record<LintCheck, string> = {
  'duplicate-path': '重名文件',
  'bean-conflict': '同名 bean',
  'dangling-import': '悬空 import',
  'pom-no-version': '缺版本依赖',
  'yml-foreign-root': '异类配置键',
};

export default function ExportGate({ scopes }: { scopes: GateScope[] }) {
  // 派生值一律走 useMemo：scopes 是调用方每帧新建的数组字面量，
  // 不 memo 的话「过滤 + 归总 + 计数」跟着每帧重跑一遍 —— 台上改一个选项
  // （每敲一次键盘就一帧）都要白算一次几百条违规的归总。
  const { blockedScopes, blocked, total, files, tally } = useMemo(() => {
    const bad = scopes.filter((s) => s.violations.length > 0);
    const t = new Map<LintCheck, number>();
    for (const s of bad) {
      for (const v of s.violations) t.set(v.check, (t.get(v.check) ?? 0) + 1);
    }
    return {
      blockedScopes: bad,
      blocked: bad.length > 0,
      total: bad.reduce((n, s) => n + s.violations.length, 0),
      files: scopes.reduce((n, s) => n + s.files, 0),
      tally: t,
    };
  }, [scopes]);

  // 五类各自命中几条 —— 用户先看「哪一类坏了」，再看逐条详情

  const tone = blocked ? TONE.bad : TONE.ok;

  return (
    <section
      className="panel overflow-hidden"
      data-export-gate={blocked ? 'blocked' : 'pass'}
      style={{ borderColor: tone.border }}
    >
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5"
        style={{ borderColor: tone.border, background: tone.soft }}
      >
        <span className="mono text-[13px] leading-none" style={{ color: tone.color }}>
          {blocked ? '✕' : '✓'}
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-[18px] text-fg">导出预检闸</h2>
          <p className="mt-0.5 text-[10px] leading-[15px] text-fgMuted">
            {blocked
              ? '这份组合打出来的包自身不自洽 —— 同名 bean / 悬空 import / 缺版本依赖 / 异类配置键，都是解包后才炸的坑，这里先拦住。'
              : `${scopes.length} 份包 · ${files} 个文件全部通过 —— 同名 bean、悬空 import、缺版本依赖、异类配置键、重名文件五类检查均无命中。`}
          </p>
        </div>
        <span
          className="mono ml-auto shrink-0 rounded-md border px-2 py-1 text-[11px]"
          style={{ borderColor: tone.border, background: tone.soft, color: tone.color }}
          data-gate-status={blocked ? 'blocked' : 'pass'}
        >
          {blocked ? `拦截 ${total} 项` : '通过'}
        </span>
      </header>

      {/* 逐包状态：哪份包能下载、哪份被拦，各自独立 —— 不合成一个数字 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-line px-4 py-2">
        {scopes.map((s) => {
          const bad = s.violations.length > 0;
          const t = bad ? TONE.bad : TONE.ok;
          return (
            <div
              key={s.id}
              className="flex items-baseline gap-1.5"
              data-gate-scope={s.id}
              data-gate-scope-status={bad ? 'blocked' : 'pass'}
            >
              <span className="mono text-[10px] leading-none" style={{ color: t.color }}>
                {bad ? '✕' : '✓'}
              </span>
              <span className="text-2xs text-fgMuted">{s.label}</span>
              <span className="mono text-[10px] text-fgFaint">
                {bad ? `拦截 ${s.violations.length} 项` : `${s.files} 文件可下载`}
              </span>
            </div>
          );
        })}
      </div>

      {blocked && (
        <>
          {/* 五类命中计数：先看坏在哪一类 */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-line px-4 py-2">
            {[...tally.entries()].map(([check, n]) => (
              <span
                key={check}
                className="mono text-[10px] leading-[15px]"
                style={{ color: TONE.bad.color }}
                data-gate-tally={check}
              >
                {CHECK_LABEL[check]} ×{n}
              </span>
            ))}
          </div>

          <ul className="divide-y divide-line" data-gate-violations="">
            {blockedScopes.flatMap((s) =>
              s.violations.map((v, i) => (
                <li
                  key={`${s.id}-${v.check}-${i}`}
                  className="px-4 py-2"
                  data-gate-violation={v.check}
                >
                  <p className="text-2xs leading-relaxed text-fgMuted">
                    <span className="mono mr-1.5" style={{ color: TONE.bad.color }}>
                      [{v.check}]
                    </span>
                    <span className="mono mr-1.5 text-fgFaint">
                      {CHECK_LABEL[v.check] ?? ''}
                    </span>
                    {v.message}
                  </p>
                  <p className="mono mt-0.5 text-[10px] text-fgFaint">{s.label}</p>
                </li>
              ))
            )}
          </ul>
          <p className="border-t border-line px-4 py-2 text-[10px] leading-[15px] text-fgFaint">
            上面的包已禁止下载 —— 修好（通常是换一个选项组合）后这里自动转绿，不用刷新页面。
          </p>
        </>
      )}
    </section>
  );
}
