'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import SeverityBadge from '@/components/SeverityBadge';
import CopyButton from '@/components/CopyButton';
import { rules as allRules } from '@/lib/rules';
import { lint, type LintReport, type SourceFile, type Violation } from '@/lib/engine';
import {
  lintRemote,
  type RemoteLintReport,
  type RemoteViolation,
} from '@/lib/arsenal-api';
import { SAMPLES } from '@/lib/samples';
import CharterCheckPanel from './CharterCheckPanel';
import { CATEGORY_THEME, CHECK_LAYER_THEME, SEVERITY_ORDER, SEVERITY_THEME } from '@/lib/theme';
import type { Severity } from '@/lib/types';

const EMPTY: SourceFile = { name: 'src/main/java/com/example/Demo.java', content: '' };

/**
 * 「后端深检」的状态机。与 arsenal-api 的三态一一对应，外加 idle / running 两个本地态。
 * 关键纪律：只有点击按钮才会离开 idle —— 静态导出站首屏不许发网络请求。
 */
type RemoteState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'offline'; message: string }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'report'; report: RemoteLintReport };

export default function CheckConsole() {
  const [files, setFiles] = useState<SourceFile[]>([
    { name: SAMPLES[0].name, content: SAMPLES[0].content },
  ]);
  const [active, setActive] = useState(0);
  const [report, setReport] = useState<LintReport | null>(null);
  const [sampleMenu, setSampleMenu] = useState(false);
  const [remote, setRemote] = useState<RemoteState>({ kind: 'idle' });
  const [deepChecking, setDeepChecking] = useState(false);
  /** 深检发出时的 files 快照：与当前 files 不是同一个引用 ⇒ 结论已过期 */
  const checkedFilesRef = useRef<SourceFile[] | null>(null);

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

  /** 代码改动后，旧的深检结论标记为「可能过期」，但不删除 —— 留着比没有强 */
  const remoteStale = remote.kind === 'report' && checkedFilesRef.current !== files;

  /**
   * 后端深检。**只能由点击触发**：静态导出站的首屏与本地校验一样零网络请求，
   * 后端不在时给出中性降级提示，本地正则层结论原样保留。
   */
  async function runDeepCheck() {
    const payload = files
      .filter((f) => f.content.trim().length > 0)
      .map((f) => ({ name: f.name, content: f.content }));
    if (deepChecking || payload.length === 0) return;
    checkedFilesRef.current = files;
    setDeepChecking(true);
    setRemote({ kind: 'running' });
    try {
      setRemote(await lintRemote(payload));
    } finally {
      setDeepChecking(false);
    }
  }

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
          当前执行的是<span className="text-fg">正则层</span>（{allRules.filter((r) => r.check?.regex?.pattern).length} 条可自动检出）；
          AST 层后端已实现 —— 点<span className="text-fg">「后端深检」</span>即可运行（需后端 arsenal-server 在运行）；
          LLM 语义层尚未启动，检不了的规则如实标注，不伪造结果。
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

        <button
          type="button"
          onClick={runDeepCheck}
          disabled={deepChecking || !files.some((f) => f.content.trim().length > 0)}
          title="把当前代码交给后端 arsenal-server 跑 AST 层深检。点击才发请求，后端不在时本地结论不受影响。"
          className="rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
          style={{ borderColor: 'rgba(217,164,65,0.45)', color: '#D9A441' }}
        >
          {deepChecking ? '后端深检中…' : '⚡ 后端深检'}
        </button>

        <div className="ml-auto flex items-center gap-3 text-2xs text-fgFaint">
          <span>
            {files.length} 个文件 · <span className="mono">{(totalBytes / 1024).toFixed(1)} KB</span>
          </span>
          {report && (
            <span>
              正则层 <span className="mono text-fgMuted">{report.durationMs} ms</span>
            </span>
          )}
          {remote.kind === 'report' && (
            <span>
              深检 <span className="mono text-fgMuted">{remote.report.durationMs} ms</span>
              {remoteStale && <span style={{ color: '#D9A441' }}> · 代码已改动</span>}
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
            className="mono w-full rounded border border-line bg-canvas px-2.5 py-1.5 text-xs text-fgMuted focus:border-brassDim focus:outline-hidden"
            placeholder="文件路径（用于匹配规则的 targetGlob，例如 src/main/java/com/x/controller/A.java）"
          />
        </div>

        <textarea
          value={cur.content}
          onChange={(e) => patchFile({ content: e.target.value })}
          spellCheck={false}
          placeholder="在这里粘贴要检查的代码…"
          className="mono block h-[400px] w-full resize-y bg-[#0E1312] px-3.5 py-3 text-[12.5px] leading-[1.65] text-fg placeholder:text-fgFaint focus:outline-hidden"
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

      {/* 项目模式：章程条款并入本地正则层。**放在报告分支之外** ——
          报告为空时也该能看到「本项目额外查了什么」，否则它一粘代码就消失。 */}
      <CharterCheckPanel files={files} />

      {/* ── 后端深检（点击按钮才会出现，本地结论永远在上、原样保留） ── */}
      {remote.kind !== 'idle' && (
        <RemotePanel state={remote} stale={remoteStale} onRerun={runDeepCheck} />
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
            （需 AST 或语义判定）。其中 AST 层后端已实现 —— 点上方
            <span className="text-fg">「后端深检」</span>即可运行；LLM 语义层尚未启动。
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

// ─────────────────────────────────────────────────────── 后端深检

const NEUTRAL_NOTE = { borderColor: 'rgba(217,164,65,0.3)', background: 'rgba(217,164,65,0.06)' };

/**
 * 「后端深检」结果区。与上面的本地正则层报告**分区显示**，来源标注清楚：
 * 本地结论在上面原样保留，这里只呈现后端 arsenal-server 给的东西 ——
 * 包括它检不了的（skipped）和本次没跑成的（unparsed），一样不许静默丢弃。
 */
function RemotePanel({
  state,
  stale,
  onRerun,
}: {
  state: RemoteState;
  stale: boolean;
  onRerun: () => void;
}) {
  if (state.kind === 'idle') return null; // 调用方只在非 idle 时渲染，这里只为收窄类型

  if (state.kind === 'running') {
    return (
      <div className="panel px-5 py-4">
        <span className="text-xs text-fgMuted">
          正在把代码交给后端 arsenal-server 深检（正则层之外的 AST 层）……
        </span>
      </div>
    );
  }

  // 后端不可达 / 请求被拒：中性降级提示（琥珀色说明条，不是红色错误态）。
  // 本地正则层结论在上面原样保留 —— 静态站不依赖后端也能用。
  if (state.kind === 'offline' || state.kind === 'rejected') {
    return (
      <div className="rounded-lg border px-4 py-3.5" style={NEUTRAL_NOTE}>
        <div className="text-[13px] font-medium" style={{ color: '#D9A441' }}>
          {state.kind === 'offline'
            ? '后端深检没跑起来 —— 上面的本地正则层结论不受影响。'
            : '后端拒绝了这次深检 —— 上面的本地正则层结论不受影响。'}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-fgMuted">
          {state.message}
          {state.kind === 'rejected' && state.code && (
            <span className="mono ml-2 text-fgFaint">（{state.code}）</span>
          )}
        </p>
        <p className="mt-1 text-2xs text-fgFaint">
          后端在运行时（bash arsenal-server/scripts/run.sh）可再点一次「后端深检」。
        </p>
      </div>
    );
  }

  const r = state.report;

  const byFile = new Map<string, RemoteViolation[]>();
  for (const v of r.violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  const astOk = r.ast.status === 'executed' || r.ast.status === 'not_applicable';
  const astColor = astOk ? '#56C596' : '#D9A441';

  return (
    <div className="space-y-4">
      {/* 深检概览 */}
      <div className="panel p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono text-2xs uppercase tracking-[0.2em] text-fgFaint">
            remote · arsenal-server
          </span>
          <span className="text-sm font-semibold text-fg">后端深检结论</span>
          <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgFaint">
            AST 层 · JDK 自带 jdk.compiler
          </span>
          <span className="mono text-2xs text-fgFaint">{r.durationMs} ms</span>
          {stale && (
            <span
              className="rounded border px-1.5 py-0.5 text-2xs"
              style={{ color: '#D9A441', borderColor: 'rgba(217,164,65,0.45)' }}
            >
              代码已改动 · 结论可能过期
              <button type="button" onClick={onRerun} className="ml-1.5 underline hover:no-underline">
                重新深检
              </button>
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          {r.decidable && r.score !== null ? (
            <div>
              <div className="text-2xs text-fgFaint">合规分（正则 + AST 层）</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="stat-num text-[24px] font-semibold leading-none text-fg">
                  {r.score}
                </span>
                <span className="text-2xs text-fgFaint">/ 100 · {r.grade}</span>
              </div>
            </div>
          ) : (
            <div className="max-w-xl">
              <div className="text-2xs text-fgFaint">合规分</div>
              <div className="mt-1 text-[15px] font-semibold" style={{ color: '#D9A441' }}>
                不可判定
              </div>
              {r.undecidability.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.undecidability.map((u, i) => (
                    <li key={i} className="text-2xs leading-relaxed text-fgMuted">
                      · {u}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {SEVERITY_ORDER.map((s) => {
              const n = r.counts[s];
              const t = SEVERITY_THEME[s];
              return (
                <span key={s} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: t.color, opacity: n ? 1 : 0.3 }}
                  />
                  <span className="text-fgMuted">{t.label}</span>
                  <span className="mono" style={{ color: n ? t.color : '#5E6E67' }}>
                    {n}
                  </span>
                </span>
              );
            })}
          </div>

          <div className="ml-auto text-right">
            <div className="text-2xs text-fgFaint">
              违规 <span className="mono text-fg">{r.violations.length}</span> 处 · 执行规则{' '}
              <span className="mono text-fgMuted">{r.executableRules}</span>/{r.rulePool} 条
            </div>
            <div className="mt-1 flex items-center justify-end gap-1.5 text-2xs" style={{ color: astColor }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: astColor }} />
              <span className="mono">{r.ast.status}</span>
              {r.ast.note && <span className="text-fgFaint">{r.ast.note}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* 深检违规明细 */}
      {byFile.size === 0 ? (
        <div className="panel px-6 py-8 text-center">
          <p className="text-sm text-fgMuted">后端深检未发现违规。</p>
          {r.unparsed.length === 0 && r.skipped.length > 0 && (
            <p className="mt-1 text-2xs text-fgFaint">
              仍有 {r.skipped.length} 条规则后端也检不了（见下方披露清单）—— 不要把「0 违规」当成通过。
            </p>
          )}
        </div>
      ) : (
        [...byFile.entries()].map(([file, list]) => (
          <div key={file} className="panel overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line bg-surfaceHi px-4 py-2.5">
              <span className="mono truncate text-xs text-fg" title={file}>
                {file}
              </span>
              <span className="mono ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs text-fgFaint">
                后端深检
              </span>
              <span
                className="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs"
                style={{ color: '#E5484D' }}
              >
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
                      <Link href={`/rules/${v.ruleId}`} className="mono text-2xs text-brass hover:underline">
                        {v.ruleId}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-xs text-fgMuted" title={v.message}>
                        {v.message}
                      </span>
                      <span className="shrink-0 text-2xs" style={{ color: cat.color }}>
                        {cat.glyph} {cat.name}
                      </span>
                    </div>

                    {v.snippet && (
                      <pre className="mono mt-2 overflow-x-auto rounded border border-line bg-[#0E1312] px-3 py-2 text-[11.5px] leading-relaxed text-fgMuted">
                        {v.snippet}
                      </pre>
                    )}

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
        ))
      )}

      {/* 本次没跑成的文件（第三类：不是违规、也不是能力边界，是「这次没结论」） */}
      {r.unparsed.length > 0 && (
        <div className="panel overflow-hidden">
          <div
            className="border-b border-line bg-surfaceHi px-4 py-2.5 text-xs font-medium"
            style={{ color: '#D9A441' }}
          >
            本次没跑成的 {r.unparsed.length} 项 —— 这些文件没有 AST 结论，不许当成「合规」读
          </div>
          <ul className="divide-y divide-line">
            {r.unparsed.map((f, i) => (
              <li key={`${f.file}-${i}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono shrink-0 rounded bg-surfaceHi px-1.5 py-0.5 text-2xs text-fgFaint">
                    {f.line > 0 ? `行 ${f.line}:${f.column}` : f.status}
                  </span>
                  <span className="mono min-w-0 flex-1 truncate text-xs text-fgMuted" title={f.file}>
                    {f.file || '（整层级条目）'}
                  </span>
                  <span className="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-2xs text-fgFaint">
                    {f.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-fgMuted">{f.message}</p>
                {f.detail && (
                  <pre className="mono mt-1.5 overflow-x-auto rounded border border-line bg-[#0E1312] px-3 py-2 text-[11.5px] leading-relaxed text-fgFaint">
                    {f.detail}
                  </pre>
                )}
                {f.unevaluatedRules.length > 0 && (
                  <div className="mt-1.5 text-2xs text-fgFaint">
                    因此未评估的规则：{f.unevaluatedRules.join('、')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 后端也检不了的规则（如实披露，不许静默） */}
      {r.skipped.length > 0 && (
        <details className="panel overflow-hidden">
          <summary className="cursor-pointer border-b border-line bg-surfaceHi px-4 py-2.5 text-xs text-fgMuted transition-colors hover:text-fg">
            后端也检不了的 {r.skipped.length} 条规则
            <span className="ml-2 text-2xs text-fgFaint">
              —— AST 层无检查器的留待 LLM 语义层（尚未启动），人工层需过目
            </span>
          </summary>
          <div className="divide-y divide-line">
            {r.skipped.map((s) => {
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
  L.push('_由「杨先生的军火库」校验台生成。本报告为正则层结论；AST 层可在校验台点「后端深检」运行（后端 arsenal-server，JDK 自带 jdk.compiler），LLM 语义层尚未启动。_');
  return L.join('\n');
}
