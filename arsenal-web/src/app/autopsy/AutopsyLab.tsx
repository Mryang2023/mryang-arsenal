'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { CANVAS_THEME_OPTIONS, type CanvasTheme } from '@/lib/arch-canvas';
import {
  buildAutopsy,
  traceSource,
  type AutopsyArtifacts,
  type AutopsySourceTrace,
} from '@/lib/autopsy-data';
import type { ProjectFacts } from '@/lib/facts-arch';
import { scanFacts, scanUpload, type ScanOutcome } from '@/lib/arsenal-api';
import { scanTechName } from '@/lib/scan-rules';
import { downloadText } from '@/lib/zip';
import ArchPanel from './ArchPanel';
import UnmatchedPanel from './UnmatchedPanel';

/**
 * 项目解剖台。
 *
 * 一句话：给一个地址 → 出「技术栈部署图 + 应用分层图 + 未识别依赖清单」。
 *
 * 三条刻意的分工（别在页面里重写任何一条）：
 *   ① **怎么拿 facts** —— `scanFacts` / `scanUpload`（`lib/arsenal-api.ts`），
 *      与 `/archify`「从代码生成」用的是同一对函数，本页不自己拼请求。
 *   ② **facts → 结论** —— `buildAutopsy()`（`lib/autopsy-data.ts`），
 *      与 CodeIntake 共用一份；本页只负责画。
 *   ③ **图怎么画** —— `arch-canvas.ts` / `arch-layered.ts`，成品渲染器，不动。
 *
 * 安全：本地目录这条路是「用户给一个路径让服务器去读」，本仓此前没有这个形态。
 * 后端 `SourceResolver.fromPath` 会 `toRealPath()`（相对路径 / `..` / 符号链接都会
 * 被解析到别处），而事实 JSON 里只带目录名 —— 所以本页把「填进去的」与
 * 「实际扫的」并排显示，末段不一致就亮出来，不许静默。
 */

type Mode = 'path' | 'git' | 'zip';

type Stage =
  | { kind: 'idle' }
  | { kind: 'scanning'; what: string }
  | { kind: 'done'; facts: ProjectFacts; requested: string }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

const MODES: [Mode, string, string][] = [
  ['path', '本地目录', 'D:/mryang/workspace/2026/arsenal/arsenal-server'],
  ['git', 'https git', 'https://github.com/owner/repo.git'],
  ['zip', '上传 zip', ''],
];

export default function AutopsyLab() {
  const [mode, setMode] = useState<Mode>('path');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [theme, setTheme] = useState<CanvasTheme>('doc');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (what: string, requested: string, fn: () => Promise<ScanOutcome>) => {
    setStage({ kind: 'scanning', what });
    const outcome = await fn();
    if (outcome.kind === 'facts') {
      setStage({ kind: 'done', facts: outcome.facts, requested });
    } else if (outcome.kind === 'offline') {
      setStage({ kind: 'failed', code: 'OFFLINE', message: outcome.message, offline: true });
    } else {
      setStage({ kind: 'failed', code: outcome.code, message: outcome.message, offline: false });
    }
  }, []);

  const onAnalyze = useCallback(() => {
    if (mode === 'zip') {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      void run(`上传 ${file.name}`, file.name, () => scanUpload(file));
      return;
    }
    const value = source.trim();
    if (!value) return;
    // git 那条路后端一直支持（SourceResolver.fromGit），只是前端没发过 —— 这里补上
    void run(`扫描 ${value}`, value, () => scanFacts({ kind: mode === 'git' ? 'git' : 'path', value }));
  }, [mode, run, source]);

  const artifacts: AutopsyArtifacts | null = useMemo(
    () => (stage.kind === 'done' ? buildAutopsy(stage.facts, theme) : null),
    [stage, theme]
  );

  const trace: AutopsySourceTrace | null =
    stage.kind === 'done' ? traceSource(stage.requested, stage.facts) : null;

  const safeName = artifacts ? artifacts.facts.root.replace(/[^\w.-]+/g, '-') : 'project';

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-[14px] font-bold text-fg">项目解剖台</h1>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
          给一个项目地址，扫出技术栈部署图、应用分层图与未识别依赖清单。
          只读扫描、不执行仓库里的任何脚本；每条结论都带文件与行号，没认出来的一律列出来而不猜。
        </p>
      </header>

      {/* ── 输入区 ── */}
      <div className="panel px-3 py-3">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、填一个项目地址</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            {MODES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={
                  'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                  (mode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'zip' ? (
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="text-[11px] text-fgMuted file:mr-2 file:rounded file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-[11px] file:text-fgMuted"
            />
          ) : (
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              placeholder={MODES.find((m) => m[0] === mode)?.[2] ?? ''}
              className="mono min-w-[280px] flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
            />
          )}

          <button
            type="button"
            onClick={onAnalyze}
            disabled={stage.kind === 'scanning' || (mode !== 'zip' && !source.trim())}
            className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
          >
            {stage.kind === 'scanning' ? '分析中…' : '一键分析'}
          </button>

          <div className="ml-auto flex items-center gap-1 rounded border border-line p-0.5">
            {CANVAS_THEME_OPTIONS.filter((t) => ['doc', 'slide', 'blueprint'].includes(t.id)).map(
              (t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  onClick={() => setTheme(t.id)}
                  className={
                    'rounded px-2 py-1 text-[11px] transition-colors ' +
                    (theme === t.id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                  }
                >
                  {t.label}
                </button>
              )
            )}
          </div>
        </div>

        <p className="mt-2 text-[10px] leading-[16px] text-fgFaint">
          扫描是只读的：不执行仓库里的任何脚本 / 构建 / 测试，单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时。
          配置文件里的 password、token 一类值在事实里一律是 <span className="mono">***</span>，结果不外发任何地方。
          本地目录会被解析成真实路径（符号链接 / <span className="mono">..</span> 都会跟着走）—— 下面会告诉你实际扫的是哪个目录。
        </p>

        {stage.kind === 'scanning' && (
          <p className="mt-2.5 mono text-[11px] text-fgMuted">{stage.what} …</p>
        )}

        {stage.kind === 'failed' && (
          <div
            className="mt-2.5 rounded border px-2.5 py-2"
            style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
          >
            <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
              {stage.offline ? '后端连不上（:3011 没起）' : `分析被拒：${stage.code}`}
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{stage.message}</p>
            {stage.offline && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                起后端：<span className="mono">SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh</span>
                。本页三条输入都要走后端扫描，没有离线兜底 —— 只有「粘贴 facts JSON」那条路
                （在 /archify 的「从代码生成」里）能纯前端算。
              </p>
            )}
          </div>
        )}
      </div>

      {artifacts && trace && stage.kind === 'done' && (
        <div className="space-y-3">
          {/* ── 扫的到底是哪儿 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              二、这次扫的是哪儿
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="mono text-fgMuted">
                输入 <span className="text-fg">{trace.requested}</span>
              </span>
              <span className="text-fgFaint">→</span>
              <span className="mono text-fgMuted">
                实际扫描 <span className="text-fg">{trace.scannedRoot || '（未给出）'}</span>
                <span className="ml-1 text-fgFaint">{trace.kind}</span>
              </span>
            </div>
            {trace.diverged && (
              <p className="mt-1 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
                填进去的末段与实际扫到的目录名不一致 —— 路径被解析到了别处（相对路径、
                <span className="mono">..</span> 或符号链接都会这样）。确认上面这行是你想扫的目录。
              </p>
            )}
          </div>

          {/* ── 事实摘要 ── */}
          <div className="panel px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fgMuted">
              <span className="mono text-fg">{artifacts.summary.root}</span>
              <span>{artifacts.summary.files} 文件</span>
              <span>{(artifacts.summary.bytes / 1024).toFixed(0)} KB</span>
              <span>{artifacts.summary.elapsedMs} ms</span>
              {artifacts.summary.buildKind && <span>构建 {artifacts.summary.buildKind}</span>}
              {artifacts.summary.javaVersion && <span>Java {artifacts.summary.javaVersion}</span>}
              <span>
                技术命中 {artifacts.summary.techs.length} 项（上画布 {artifacts.summary.onCanvasCount} 项）
              </span>
              {artifacts.summary.truncated && (
                <span style={{ color: '#E5A33D' }}>已被闸门截断，事实不完整</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {artifacts.summary.techs.map((t) => (
                <span
                  key={t.tech}
                  title={t.onCanvas ? '会出现在部署图上' : '已识别，但不占部署节点'}
                  className="mono rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    background: t.onCanvas ? 'rgba(217,164,65,0.14)' : 'rgba(255,255,255,0.05)',
                    color: t.onCanvas ? '#D9A441' : '#93A39C',
                  }}
                >
                  {scanTechName(t.tech)}
                </span>
              ))}
              {artifacts.summary.techs.length === 0 && (
                <span className="text-[10.5px]" style={{ color: '#E5A33D' }}>
                  一项技术都没命中 —— 多半是没读到构建文件，下面的图会是空的（空是事实，不补节点）
                </span>
              )}
            </div>
          </div>

          {/* ── 架构面板 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">三、架构面板</p>
            <div className="mt-2">
              <ArchPanel artifacts={artifacts} safeName={safeName} />
            </div>
          </div>

          {/* ── 未识别依赖 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              四、未识别依赖
            </p>
            <div className="mt-2">
              <UnmatchedPanel facts={artifacts.facts} />
            </div>
          </div>

          {/* ── 这次怎么选的 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              五、这次怎么选的（每条都带文件:行）
            </p>
            <ul className="mt-1.5 space-y-1 text-[10.5px] leading-[16px] text-fgMuted">
              {artifacts.built.detail.fromDeps.map((d) => (
                <li key={`dep-${d.dim}`} className="mono">
                  <span className="text-fg">
                    {d.dim}={d.opt}
                  </span>{' '}
                  ← {d.evidence.path}:{d.evidence.line}
                </li>
              ))}
              {artifacts.built.detail.fromDeploy.map((d) => (
                <li key={`dp-${d.dim}`} className="mono">
                  <span className="text-fg">
                    {d.dim}={d.opt}
                  </span>{' '}
                  ← 部署清单 {d.because}
                </li>
              ))}
              {artifacts.built.detail.conflicts.map((c) => (
                <li key={`cf-${c.dim}`} style={{ color: '#E5A33D' }}>
                  · {c.dim} 命中多个候选，图上只画了 {c.kept}；另有 {c.dropped.join('、')} 未采用
                </li>
              ))}
              {artifacts.built.detail.fromDeps.length === 0 &&
                artifacts.built.detail.fromDeploy.length === 0 && (
                  <li style={{ color: '#E5A33D' }}>
                    · 一个槽位都没选出来 —— 没有依赖命中映射表里的任何 dim，图上是空的
                  </li>
                )}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    JSON.stringify(artifacts.facts, null, 2),
                    `${safeName}-facts.json`,
                    'application/json'
                  )
                }
                className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              >
                下载事实 JSON
              </button>
              <span className="text-[10px] text-fgFaint">
                这份 JSON 可以留档 —— 下次不必重新扫仓库（棒 3 的快照就存它）
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
