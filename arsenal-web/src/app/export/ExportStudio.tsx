'use client';

import { useMemo, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import {
  buildExport,
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FORMATS,
  estimateTokens,
  formatBytes,
  type ExportFormat,
  type ExportOptions,
} from '@/lib/exporters';
import { rules as allRules, liveStats } from '@/lib/rules';
import { CATEGORY_ORDER, CATEGORY_THEME, SEVERITY_ORDER, SEVERITY_THEME } from '@/lib/theme';
import type { CategoryKey, Severity } from '@/lib/types';

export default function ExportStudio() {
  const [format, setFormat] = useState<ExportFormat>('prompt');
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  const selected = EXPORT_FORMATS.find((f) => f.key === format)!;

  const output = useMemo(() => {
    try {
      return buildExport(format, allRules, opts);
    } catch (e) {
      return `导出失败：${(e as Error).message}`;
    }
  }, [format, opts]);

  const included = useMemo(
    () =>
      allRules.filter(
        (r) =>
          r.status === 'active' &&
          opts.severities.includes(r.severity) &&
          opts.categories.includes(r.category)
      ).length,
    [opts]
  );

  const tokens = estimateTokens(output);
  const chars = output.length;

  function toggleSeverity(s: Severity) {
    setOpts((p) => ({
      ...p,
      severities: p.severities.includes(s)
        ? p.severities.filter((x) => x !== s)
        : [...p.severities, s],
    }));
  }

  function toggleCategory(c: CategoryKey) {
    setOpts((p) => ({
      ...p,
      categories: p.categories.includes(c)
        ? p.categories.filter((x) => x !== c)
        : [...p.categories, c],
    }));
  }

  function download() {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selected.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const lightFormats: ExportFormat[] = ['prompt', 'cursorrules', 'claude', 'mcp'];

  return (
    <div className="animate-fade-up space-y-5">
      <header>
        <div className="mono text-2xs uppercase tracking-[0.2em] text-fgFaint">dispatch</div>
        <h1 className="mt-1 text-[22px] font-semibold text-fg">导出中心</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-fgMuted">
          同一份规则数据，编译成不同 AI 能直接吃下的形式。
          这里没有第二份数据源 —— 你在规则库里看到的每一条，都原样出现在下面的导出结果里。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
        {/* ── 左：载体选择 ─────────────────────────────── */}
        <div className="space-y-2 lg:sticky lg:top-9 lg:self-start">
          {EXPORT_FORMATS.map((f) => {
            const on = f.key === format;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFormat(f.key)}
                className="w-full rounded-lg border px-3.5 py-3 text-left transition-colors"
                style={{
                  borderColor: on ? 'rgba(217,164,65,0.5)' : '#243029',
                  background: on ? 'rgba(217,164,65,0.07)' : '#131917',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="mono text-[11px]"
                    style={{ color: on ? '#D9A441' : '#5E6E67' }}
                  >
                    {on ? '●' : '○'}
                  </span>
                  <span className="text-[13px] font-semibold text-fg">{f.name}</span>
                  {f.key === 'mcp' && (
                    <span className="ml-auto rounded border border-line px-1 py-0.5 text-[10px] text-fgFaint">
                      P1
                    </span>
                  )}
                </div>
                <div className="mono mt-1 text-2xs text-fgFaint">{f.target}</div>
                <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{f.blurb}</p>
              </button>
            );
          })}

          <div className="rounded-lg border border-dashed border-line px-3.5 py-3 text-2xs leading-relaxed text-fgFaint">
            完整的规范书（人读版）也在列表里 —— 那份是给你自己归档用的，
            不是给 AI 的。
          </div>
        </div>

        {/* ── 右：配置 + 预览 ─────────────────────────── */}
        <div className="min-w-0 space-y-3">
          {/* 意图说明 */}
          <div className="panel px-4 py-3.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold text-fg">{selected.name}</span>
              <span className="mono text-2xs text-fgFaint">{selected.filename}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fgMuted">{selected.why}</p>
          </div>

          {/* 筛选 */}
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-2xs text-fgFaint">级别</span>
                {SEVERITY_ORDER.map((s) => {
                  const on = opts.severities.includes(s);
                  const t = SEVERITY_THEME[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSeverity(s)}
                      className="rounded border px-2 py-0.5 text-2xs transition-colors"
                      style={{
                        color: on ? t.color : '#93A39C',
                        borderColor: on ? t.color + '66' : '#243029',
                        background: on ? t.soft : 'transparent',
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-2xs text-fgFaint">分类</span>
                <button
                  type="button"
                  onClick={() =>
                    setOpts((p) => ({
                      ...p,
                      categories: p.categories.length === CATEGORY_ORDER.length ? [] : [...CATEGORY_ORDER],
                    }))
                  }
                  className="rounded border border-line px-2 py-0.5 text-2xs text-fgMuted transition-colors hover:text-fg"
                >
                  {opts.categories.length === CATEGORY_ORDER.length ? '全不选' : '全选'}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {CATEGORY_ORDER.map((c) => {
                const on = opts.categories.includes(c);
                const t = CATEGORY_THEME[c];
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCategory(c)}
                    className="rounded border px-2 py-0.5 text-2xs transition-colors"
                    style={{
                      color: on ? t.color : '#5E6E67',
                      borderColor: on ? t.color + '66' : '#243029',
                      background: on ? t.color + '16' : 'transparent',
                    }}
                  >
                    {t.glyph} {t.name}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
              <span className="text-2xs text-fgFaint">内容</span>
              {(
                [
                  ['includeExamples', '反例 / 正例'],
                  ['includeRationale', '设计理由'],
                  ['includeSources', '出处溯源'],
                  ['includeChecks', '检测方式'],
                ] as const
              ).map(([key, label]) => {
                const on = Boolean(opts[key]);
                return (
                  <label key={key} className="flex cursor-pointer items-center gap-1.5 text-2xs">
                    <span
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px]"
                      style={{
                        borderColor: on ? 'rgba(217,164,65,0.6)' : '#33413A',
                        background: on ? 'rgba(217,164,65,0.2)' : 'transparent',
                        color: '#D9A441',
                      }}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={(e) => setOpts((p) => ({ ...p, [key]: e.target.checked }))}
                    />
                    <span className={on ? 'text-fgMuted' : 'text-fgFaint'}>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 预览工具条 */}
          <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-xs text-fgMuted">
              包含 <span className="mono text-fg">{included}</span> / {liveStats.total} 条规则
            </span>
            <span className="text-lineHi">|</span>
            <span className="mono text-2xs text-fgFaint">
              {formatBytes(output)} · {chars.toLocaleString()} 字符 · ≈ {tokens.toLocaleString()} tokens
            </span>
            {lightFormats.includes(format) && tokens > 3000 && (
              <span className="text-2xs" style={{ color: '#D9A441' }}>
                ⚠ 偏长，建议只保留「强制 + 禁止」级
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <CopyButton text={output} label="复制全部" />
              <button
                type="button"
                onClick={download}
                className="rounded border px-2.5 py-1.5 text-xs transition-colors"
                style={{
                  color: '#E8F0EC',
                  borderColor: '#33413A',
                  background: '#1A2220',
                }}
              >
                ↓ 下载 .{selected.filename.split('.').pop()}
              </button>
            </div>
          </div>

          {/* 源文件视图：这里是编译产物的原文（.md），不是渲染后的文档 */}
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-surfaceHi px-4 py-2">
              <span className="mono text-2xs uppercase tracking-wider text-fgFaint">
                source · 源文件
              </span>
              <span className="mono ml-auto text-2xs text-fgFaint">{selected.filename}</span>
            </div>
            <pre className="mono max-h-[560px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[11.5px] leading-[1.7] text-fgMuted">
              {output}
            </pre>
          </div>

          <p className="text-2xs leading-relaxed text-fgFaint">
            用法：「复制全部」→ 粘进 AI 的自定义指令 / 项目根目录文件。
            .cursorrules 与 CLAUDE.md 记得放在<span className="text-fgMuted">项目根目录</span>，
            否则对应工具读不到。
          </p>
        </div>
      </div>
    </div>
  );
}
