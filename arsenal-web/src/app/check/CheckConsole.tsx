'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import SeverityBadge from '@/components/SeverityBadge';
import CopyButton from '@/components/CopyButton';
import { rules as allRules } from '@/lib/rules';
import { lint, type LintReport, type SourceFile, type Violation } from '@/lib/engine';
import { SAMPLES } from '@/lib/samples';
import { CATEGORY_THEME, CHECK_LAYER_THEME, SEVERITY_ORDER, SEVERITY_THEME } from '@/lib/theme';
import type { Severity } from '@/lib/types';

const EMPTY: SourceFile = { name: 'src/main/java/com/example/Demo.java', content: '' };

export default function CheckConsole() {
  const [files, setFiles] = useState<SourceFile[]>([
    { name: SAMPLES[0].name, content: SAMPLES[0].content },
  ]);
  const [active, setActive] = useState(0);
  const [report, setReport] = useState<LintReport | null>(null);
  const [sampleMenu, setSampleMenu] = useState(false);

  // 实时校验（防抖）。引擎是纯函数、62 条规则毫秒级，无需按钮打断手感。
  useEffect(() => {
    const t = setTimeout(() => {
      const has = files.some((f) => f.content.trim().length > 0);
      setReport(has ? lint(files, allRules) : null);
    }, 320);
    return () => clearTimeout(t);
  }, [files]);

  const cur = files[active] ?? files[0] ?? EMPTY;

  const totalBytes = useMemo(
    () => files.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0),
    [files]
  );

  function patchFile(patch: Partial<SourceFile>) {
    setFiles((prev) => prev.map((f, i) => (i === active ? { ...f, ...patch } : f)));
  }

  function addFile(sample?: (typeof SAMPLES)[number]) {
    const nf: SourceFile = sample
      ? { name: sample.name, content: sample.content }
      : { ...EMPTY, name: `src/main/java/com/example/NewFile${files.length + 1}.java` };
    setFiles((prev) => {
      const next = [...prev, nf];
      setActive(next.length - 1);
      return next;
    });
    setSampleMenu(false);
  }

  function removeFile(i: number) {
    setFiles((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== i);
      setActive((a) => Math.min(a, next.length - 1));
      return next;
    });
  }

  function loadSample(s: (typeof SAMPLES)[number]) {
    setFiles([{ name: s.name, content: s.content }]);
    setActive(0);
    setSampleMenu(false);
  }

  return (
    <div className="animate-fade-up space-y-5">
      <header>
        <div className="mono text-2xs uppercase tracking-[0.2em] text-fgFaint">linter</div>
        <h1 className="mt-1 text-[22px] font-semibold text-fg">校验台</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-fgMuted">
          粘贴代码，按 {allRules.length} 条规则逐条比对，输出带行号的违规清单。
          当前执行的是<span className="text-fg">正则层</span>（{allRules.filter((r) => r.check?.regex?.pattern).length} 条可自动检出），
          语义与 AST 层如实标注为「需后端判定」，不伪造结果。
        </p>
      </header>

      {/* ── 工具栏 ───────────────────────────────────── */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => addFile()}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          ＋ 新建文件
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setSampleMenu((v) => !v)}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            载入示例 ▾
          </button>
          {sampleMenu && (
            <>
              <button
                type="button"
                aria-label="关闭"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setSampleMenu(false)}
              />
              <div className="absolute left-0 top-full z-20 mt-1 w-[300px] overflow-hidden rounded-md border border-lineHi bg-surface shadow-lift">
                {SAMPLES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => loadSample(s)}
                    className="block w-full border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surfaceHi"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-fg">{s.label}</span>
                      <span className="mono ml-auto text-2xs text-fgFaint">
                        正则层预期 {s.expected} 处
                      </span>
                    </div>
                    <div className="mt-0.5 text-2xs leading-relaxed text-fgFaint">{s.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setFiles([{ ...EMPTY }]);
            setActive(0);
          }}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          清空
        </button>

        <div className="ml-auto flex items-center gap-3 text-2xs text-fgFaint">
          <span>
            {files.length} 个文件 · <span className="mono">{(totalBytes / 1024).toFixed(1)} KB</span>
          </span>
          {report && (
            <span>
              上次校验 <span className="mono text-fgMuted">{report.durationMs} ms</span>
            </span>
          )}
        </div>
      </div>

      {/* ── 编辑区 ───────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 pt-2">
          {files.map((f, i) => {
            const on = i === active;
            return (
              <span
                key={i}
                className="group flex shrink-0 items-center gap-1 rounded-t border-b-2 px-2.5 py-1.5 transition-colors"
                style={{
                  borderColor: on ? '#D9A441' : 'transparent',
                  background: on ? 'rgba(217,164,65,0.07)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  className="mono max-w-[190px] truncate text-2xs"
                  style={{ color: on ? '#E8F0EC' : '#93A39C' }}
                  title={f.name}
                >
                  {f.name.split('/').pop()}
                </button>
                {files.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-2xs opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: '#93A39C' }}
                    title="移除"
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
        </div>

        <div className="border-b border-line px-3 py-2">
          <input
            value={cur.name}
            onChange={(e) => patchFile({ name: e.target.value })}
            className="mono w-full rounded border border-line bg-canvas px-2.5 py-1.5 text-xs text-fgMuted focus:border-brassDim focus:outline-none"
            placeholder="文件路径（用于匹配规则的 targetGlob，例如 src/main/java/com/x/controller/A.java）"
          />
        </div>

        <textarea
          value={cur.content}
          onChange={(e) => patchFile({ content: e.target.value })}
          spellCheck={false}
          placeholder="在这里粘贴要检查的代码…"
          className="mono block h-[400px] w-full resize-y bg-[#0E1312] px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg placeholder:text-fgFaint focus:outline-none"
        />
      </div>

      {/* ── 报告 ─────────────────────────────────────── */}
      {!report ? (
        <div className="panel px-6 py-12 text-center">
          <div className="text-2xl text-fgFaint">⛨</div>
          <p className="mt-2 text-sm text-fgMuted">粘贴代码后会自动开始校验。</p>
          <p className="mt-1 text-2xs text-fgFaint">也可以先点上面的「载入示例」看它怎么工作。</p>
        </div>
      ) : (
        <ReportView report={report} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── 报告

function gradeColor(score: number): string {
  if (score >= 95) return '#56C596';
  if (score >= 85) return '#7FA650';
  if (score >= 70) return '#D9A441';
  return '#E5484D';
}

function ReportView({ report }: { report: LintReport }) {
  const color = gradeColor(report.score);
  const byFile = useMemo(() => {
    const m = new Map<string, Violation[]>();
    for (const v of report.violations) {
      const list = m.get(v.file) ?? [];
      list.push(v);
      m.set(v.file, list);
    }
    return [...m.entries()];
  }, [report]);

  const md = reportToMarkdown(report);

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing score={report.score} grade={report.grade} color={color} />

          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Metric
              label="违规总数"
              value={report.violations.length}
              accent={report.violations.length === 0 ? '#56C596' : '#E5484D'}
              sub={`涉及 ${report.byRule.length} 条规则`}
            />
            <Metric
              label="已扫描规则"
              value={report.executableRules}
              sub={`规则池 ${report.rulePool} 条`}
            />
            <Metric
              label="文件 / 行"
              value={report.fileCount}
              sub={`${report.totalLines} 行代码`}
            />
            <Metric
              label="耗时"
              value={report.durationMs}
              unit="ms"
              sub="纯本地，无网络"
            />
          </div>

          <div className="shrink-0">
            <CopyButton text={md} label="复制报告" />
          </div>
        </div>

        {/* 按级别 */}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4">
          {SEVERITY_ORDER.map((s) => {
            const n = report.counts[s];
            const t = SEVERITY_THEME[s];
            return (
              <span key={s} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: t.color, opacity: n ? 1 : 0.3 }} />
                <span className="text-fgMuted">{t.label}</span>
                <span className="mono" style={{ color: n ? t.color : '#5E6E67' }}>
                  {n}
                </span>
              </span>
            );
          })}
          {report.notApplicable > 0 && (
            <span className="text-2xs text-fgFaint">
              （另有 {report.notApplicable} 次规则-文件组合因路径不匹配而跳过）
            </span>
          )}
        </div>
      </div>

      {/* 零违规的诚实说明 */}
      {report.violations.length === 0 && (
        <div
          className="rounded-lg border px-4 py-3.5"
          style={{ borderColor: 'rgba(217,164,65,0.3)', background: 'rgba(217,164,65,0.06)' }}
        >
          <div className="text-[13px] font-medium" style={{ color: '#D9A441' }}>
            正则层未发现违规 —— 但这不等于代码合规。
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-fgMuted">
            还有 <span className="mono text-fg">{report.skipped.length}</span> 条规则是正则层检不了的
            （需 AST 或语义判定）。想让它们也跑起来，要等后端 arsenal-server 的 JavaParser 与 LLM 层。
            现阶段请不要把「0 违规」当成通过。
          </p>
        </div>
      )}

      {/* 违规明细 */}
      {byFile.map(([file, list]) => (
        <div key={file} className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-surfaceHi px-4 py-2.5">
            <span className="mono truncate text-xs text-fg" title={file}>
              {file}
            </span>
            <span className="mono ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs" style={{ color: '#E5484D' }}>
              {list.length}
            </span>
          </div>

          <ul className="divide-y divide-line">
            {list.map((v, i) => {
              const cat = CATEGORY_THEME[v.category];
              return (
                <li key={`${v.ruleId}-${v.line}-${i}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono shrink-0 rounded bg-surfaceHi px-1.5 py-0.5 text-2xs text-fgFaint">
                      行 {v.line}:{v.column}
                    </span>
                    <SeverityBadge severity={v.severity} size="sm" />
                    <Link
                      href={`/rules/${v.ruleId}`}
                      className="mono text-2xs text-brass hover:underline"
                    >
                      {v.ruleId}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-xs text-fgMuted" title={v.title}>
                      {v.title}
                    </span>
                    <span className="shrink-0 text-2xs" style={{ color: cat.color }}>
                      {cat.glyph} {cat.name}
                    </span>
                  </div>

                  <pre className="mono mt-2 overflow-x-auto rounded border border-line bg-[#0E1312] px-3 py-2 text-[11.5px] leading-relaxed text-fgMuted">
                    {v.snippet}
                  </pre>

                  <div className="mt-2 flex items-start gap-2 text-2xs leading-relaxed">
                    <span className="shrink-0 text-fgFaint">改为</span>
                    <span className="min-w-0 flex-1 text-fgMuted">{v.fix}</span>
                    <CopyButton text={v.fix} compact label="复制修复建议" />
                  </div>
                  {v.collapsed > 0 && (
                    <div className="mt-1.5 text-2xs text-fgFaint">
                      同文件另有 {v.collapsed} 处同类违规未逐条展开。
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* 按规则聚合 */}
      {report.byRule.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="border-b border-line bg-surfaceHi px-4 py-2.5">
            <span className="text-xs font-medium text-fg">违反最多的规则</span>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-wider text-fgFaint">
                <th className="px-4 py-2 font-medium">规则</th>
                <th className="px-3 py-2 font-medium">级别</th>
                <th className="px-3 py-2 text-right font-medium">命中</th>
                <th className="px-4 py-2 text-right font-medium">文件</th>
              </tr>
            </thead>
            <tbody>
              {report.byRule.map((x) => (
                <tr key={x.ruleId} className="border-b border-line/50 last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/rules/${x.ruleId}`} className="text-fgMuted hover:text-fg">
                      <span className="mono mr-2 text-2xs text-brass">{x.ruleId}</span>
                      {x.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={x.severity} size="sm" />
                  </td>
                  <td className="mono px-3 py-2 text-right text-fg">{x.count}</td>
                  <td className="mono px-4 py-2 text-right text-fgFaint">{x.files}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 未覆盖规则 */}
      {report.skipped.length > 0 && (
        <details className="panel overflow-hidden">
          <summary className="cursor-pointer border-b border-line bg-surfaceHi px-4 py-2.5 text-xs text-fgMuted transition-colors hover:text-fg">
            正则层检不了的 {report.skipped.length} 条规则
            <span className="ml-2 text-2xs text-fgFaint">
              —— 它们需要 AST 或语义判定，故意不在这里给结论
            </span>
          </summary>
          <div className="divide-y divide-line">
            {report.skipped.map((s) => {
              const layer = CHECK_LAYER_THEME[s.layer];
              const cat = CATEGORY_THEME[s.category];
              return (
                <div key={s.ruleId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className="mono text-2xs text-fgFaint">{s.ruleId}</span>
                  <SeverityBadge severity={s.severity} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-xs text-fgMuted">{s.title}</span>
                  <span className="mono shrink-0 text-2xs" style={{ color: layer.color }}>
                    {layer.label}
                  </span>
                  <span className="w-full text-2xs text-fgFaint md:w-auto">{s.reason}</span>
                  <span className="shrink-0 text-2xs" style={{ color: cat.color }}>
                    {cat.glyph}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── 零件

function ScoreRing({ score, grade, color }: { score: number; grade: string; color: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative h-[108px] w-[108px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1E2624" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: 'stroke-dasharray .5s cubic-bezier(.22,1,.36,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="stat-num text-[27px] font-semibold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="mt-1 text-2xs" style={{ color }}>
          {grade}
        </span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
  accent = '#E8F0EC',
}: {
  label: string;
  value: number;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-2xs text-fgFaint">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="stat-num text-[21px] font-semibold leading-none" style={{ color: accent }}>
          {value}
        </span>
        {unit && <span className="mono text-2xs text-fgFaint">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-2xs text-fgFaint">{sub}</div>}
    </div>
  );
}

function reportToMarkdown(r: LintReport): string {
  const L: string[] = [];
  L.push('# 军火库 · 代码校验报告');
  L.push('');
  L.push(`- 合规分：**${r.score} / 100**（${r.grade}）`);
  L.push(`- 违规：${r.violations.length} 处，涉及 ${r.byRule.length} 条规则`);
  L.push(`- 扫描：${r.fileCount} 个文件 / ${r.totalLines} 行，执行规则 ${r.executableRules} 条`);
  L.push(`- 耗时：${r.durationMs} ms`);
  L.push('');
  L.push('| 级别 | 数量 |');
  L.push('|---|---|');
  for (const s of SEVERITY_ORDER) L.push(`| ${SEVERITY_THEME[s].label}（${s}） | ${r.counts[s as Severity]} |`);
  L.push('');

  const byFile = new Map<string, Violation[]>();
  for (const v of r.violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  for (const [file, list] of byFile) {
    L.push(`## ${file}`);
    L.push('');
    for (const v of list) {
      L.push(`### \`${v.ruleId}\` 行 ${v.line}:${v.column} · ${SEVERITY_THEME[v.severity].label}`);
      L.push('');
      L.push(`**${v.title}**`);
      L.push('');
      L.push('```');
      L.push(v.snippet);
      L.push('```');
      L.push('');
      L.push(`> 修复：${v.fix}`);
      L.push('');
    }
  }

  if (r.skipped.length) {
    L.push('## 未覆盖（正则层检不了）');
    L.push('');
    for (const s of r.skipped) L.push(`- \`${s.ruleId}\` ${s.title} —— ${s.reason}`);
    L.push('');
  }

  L.push('---');
  L.push('_由「杨先生的军火库」校验台生成。当前仅执行正则层，语义/AST 层由后端 arsenal-server 补齐。_');
  return L.join('\n');
}
