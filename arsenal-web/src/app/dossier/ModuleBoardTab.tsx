'use client';

/**
 * 项目档案 · 「模块开发」页签。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * IEMS 按模块开发，每个模块都走同一条路：
 *
 *   ① 设计说明 → ② 表结构 → ③ 四件套 → ④ 后端 → ⑤ 接口文档 → ⑥ 前端 → ⑦ 人工验收
 *
 * 这一页把这条路投影出来，每一格**只认仓库里的文件**：
 * 设计说明在不在、四件套齐不齐、Controller 有几个接口、文档对没对上、前端目录有没有东西。
 *
 * 页面里没有「标记完成」按钮，这是刻意的。手动状态两天就会和仓库脱节，
 * 然后没人知道该信哪个 —— 文件在，格子就绿；文件不在，谁说做完了都不算。
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useEffect, useState } from 'react';
import {
  getModuleBoard,
  type DdlIssue,
  type ModuleBoard,
  type ModuleEntry,
  type ModuleStage,
  type ModuleStageStatus,
} from '@/lib/projects-api';

type BoardLoad =
  | { kind: 'loading' }
  | { kind: 'ok'; data: ModuleBoard }
  | { kind: 'failed'; message: string; offline?: boolean };

export default function ModuleBoardTab({ pid }: { pid: string }) {
  const [load, setLoad] = useState<BoardLoad>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    getModuleBoard(pid).then((o) => {
      if (!alive) return;
      if (o.kind === 'ok') setLoad({ kind: 'ok', data: o.data });
      else if (o.kind === 'offline') setLoad({ kind: 'failed', message: o.message, offline: true });
      else setLoad({ kind: 'failed', message: `${o.code}：${o.message}` });
    });
    return () => {
      alive = false;
    };
  }, [pid, nonce]);

  if (load.kind === 'loading') {
    return <p className="mt-5 text-sm text-fgMuted">正在按仓库推断模块进度…</p>;
  }

  if (load.kind === 'failed') {
    return (
      <div className="mt-5 panel px-4 py-4">
        <p className="text-sm text-fg">{load.message}</p>
        {load.offline && (
          <p className="mt-2 text-xs text-fgMuted">
            看板要连后端 :3011，起服务的命令：<code className="mono">bash arsenal-server/scripts/run.sh</code>
          </p>
        )}
      </div>
    );
  }

  const data = load.data;

  if (!data.available) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        项目缓存不存在 —— 没有可推断的东西。去「项目管理」刷新一次缓存。
      </p>
    );
  }

  const s = data.summary;

  return (
    <div className="mt-4 space-y-5">
      {/* ── 总览 ── */}
      <section className="panel px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-3xl font-medium text-fg">{s.modules}</span>
          <span className="text-xs text-fgMuted">个模块</span>
          <span className="text-xs text-fgMuted">
            {s.acceptReady} 可验收 · {s.inProgress} 进行中 · {s.notStarted} 未开始
          </span>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="ml-auto rounded border border-line px-2.5 py-1 text-2xs text-fgMuted transition-colors hover:bg-surfaceHi hover:text-fg"
          >
            重新推断
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {['设计说明', '表结构', '四件套', '后端', '接口文档', '前端'].map((label, i) => {
            const done = s.stageDone[`stage${i + 1}`] ?? 0;
            const pct = s.modules ? Math.round((done * 100) / s.modules) : 0;
            return (
              <div key={label}>
                <div className="flex items-baseline justify-between text-2xs">
                  <span className="text-fgMuted">
                    {i + 1} {label}
                  </span>
                  <span className={done === s.modules && done > 0 ? 'text-olive' : 'text-fg'}>
                    {done}/{s.modules}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-surfaceHi">
                  <div
                    className={done === s.modules && done > 0 ? 'h-full bg-olive' : 'h-full bg-brass'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-2xs text-fgMuted">
          前端项目：
          {data.frontend.detected ? (
            <span className="text-fg">
              {data.frontend.name || data.frontend.id}
              <code className="ml-2 mono text-fgFaint">{data.frontend.path}</code>
              {data.frontend.fromCache && <span className="ml-2 text-fgFaint">（读缓存）</span>}
            </span>
          ) : (
            <span className="text-brass">未检测到同父目录的前端项目</span>
          )}
        </p>

        <p className="mt-1 text-2xs text-fgFaint">{data.note}</p>
      </section>

      {/* ── 证据不足时的提示（缺打法文件、缺前端项目等）── */}
      {data.notes.length > 0 && (
        <section className="panel px-4 py-3">
          <ul className="space-y-1">
            {data.notes.map((n, i) => (
              <li key={i} className="text-xs">
                <span className={`mr-2 ${issueTone(n.level)}`}>{levelLabel(n.level)}</span>
                <span className="text-fgMuted">{n.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 模块 ── */}
      {data.modules.length === 0 ? (
        <section className="rounded border border-dashed border-line px-4 py-5">
          <p className="text-sm text-fg">还没有可识别的模块。</p>
          <p className="mt-2 text-xs text-fgMuted">
            看板靠文件名认模块。先写一份设计说明：
            <code className="ml-1 mono">docs/design/YYYY-MM-DD-&lt;module&gt;.md</code>
            ，模块就会出现在这里。
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {data.modules.map((m) => (
            <ModuleCard key={m.module} m={m} />
          ))}
        </div>
      )}

      <p className="text-2xs text-fgFaint">
        只读推断：军火库不保存第二份进度，也不写被管理的项目。状态变了，是仓库变了。
      </p>
    </div>
  );
}

function ModuleCard({ m }: { m: ModuleEntry }) {
  const [open, setOpen] = useState(m.progress.done < m.progress.total);
  const done = m.progress.done;

  return (
    <section className="panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <span className="text-sm text-fg">{m.label}</span>
        <code className="mono text-2xs text-fgFaint">{m.module}</code>
        <span className={`text-2xs ${done === m.progress.total ? 'text-olive' : 'text-fgMuted'}`}>
          {done}/{m.progress.total}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden w-28 overflow-hidden rounded bg-surfaceHi sm:block">
            <span
              className={`block h-1.5 ${done === m.progress.total ? 'bg-olive' : 'bg-brass'}`}
              style={{ width: `${m.progress.percent}%` }}
            />
          </span>
          <span className="text-2xs text-fgFaint">{open ? '收起' : '展开'}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-4 py-3">
          <ol className="space-y-2">
            {m.stages.map((st) => (
              <StageRow key={st.no} st={st} />
            ))}
          </ol>

          {m.nextAction && (
            <p className="mt-3 rounded border border-brass/30 bg-brass/5 px-3 py-2 text-xs text-brass">
              下一步：{m.nextAction}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function StageRow({ st }: { st: ModuleStage }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 w-5 shrink-0 text-right mono text-2xs text-fgFaint">{st.no}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs text-fg">{st.name}</span>
          <StatusPill status={st.status} />
        </div>
        <p className="mt-0.5 text-2xs text-fgMuted">{st.detail}</p>

        {(st.evidence.length > 0 || st.missing.length > 0) && (
          <ul className="mt-1 space-y-0.5">
            {st.evidence.map((e, i) => (
              <li key={`e${i}`} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
                <span className="text-olive">✓</span>
                <RootTag root={e.root} />
                <code className="break-all mono text-fgMuted">{e.path}</code>
                {e.note && <span className="text-fgFaint">{e.note}</span>}
              </li>
            ))}
            {st.missing.map((m, i) => (
              <li key={`m${i}`} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
                <span className="text-rust">✕</span>
                <RootTag root={m.root} />
                <code className="break-all mono text-fgFaint">{m.path}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: ModuleStageStatus }) {
  const label =
    status === 'done' ? '已完成' : status === 'partial' ? '部分' : status === 'ready' ? '可验收' : '未开始';
  return (
    <span className={`rounded border px-1.5 py-0.5 text-2xs ${pillTone(status)}`}>{label}</span>
  );
}

function RootTag({ root }: { root: 'backend' | 'frontend' }) {
  return (
    <span className="rounded border border-line px-1 py-px text-[10px] text-fgFaint">
      {root === 'backend' ? '后端' : '前端'}
    </span>
  );
}

function pillTone(status: ModuleStageStatus): string {
  switch (status) {
    case 'done':
      return 'border-olive/40 text-olive';
    case 'ready':
      return 'border-olive/60 bg-olive/10 text-olive';
    case 'partial':
      return 'border-brass/40 text-brass';
    default:
      return 'border-line text-fgFaint';
  }
}

function issueTone(level: DdlIssue['level']): string {
  return level === 'error' ? 'text-rust' : level === 'warn' ? 'text-brass' : 'text-fgFaint';
}

function levelLabel(level: DdlIssue['level']): string {
  return level === 'error' ? '必改' : level === 'warn' ? '注意' : '说明';
}
