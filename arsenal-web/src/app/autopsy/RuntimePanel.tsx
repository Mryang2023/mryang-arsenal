'use client';

import { useMemo, useState } from 'react';
import {
  evidenceText,
  groupByKind,
  reconcileRuntime,
  type ReconVerdict,
  type RuntimeProbeFact,
} from '@/lib/runtime-recon';
import type { RuntimeKind } from '@/lib/arsenal-api';

/**
 * 活体解剖（第六页签）—— 「静态声明的，运行时是不是真的」。
 *
 * 这一页与前五页的根本区别：**前五页一个字节都不执行**，这一页会。
 * 后端把项目复制到临时工作副本里真跑起来（用户的目录一个字节都不动），
 * 所以本页必须把三件事写在脸上，不许藏在折叠里：
 *
 *   ① **会执行什么** —— 主类名是用户在下面点的那个，后端不猜「该跑哪个类」。
 *      猜错的表现是「起不来」，而项目真的起不来时也是「起不来」，
 *      两者在结果上长得一模一样 —— 这个歧义只能由「谁来挑」消掉。
 *   ② **没跑成与跑通了必须长得不一样** —— `not-run` / `mismatch` / `match`
 *      三档各有各的措辞与颜色，且 `not-run` 一定带原因。
 *   ③ **只有 spring-boot 是真跑通的** —— node-start / plain-main 是**显式降级**
 *      （后端回 `supported=false`），不是「还没接」；本页把它们列出来并标注不可用，
 *      不给一个点了才知道坏的按钮。
 *
 * 判定本身在 `lib/runtime-recon.ts`（全仓唯一一份），本页只负责画。
 */

export interface EntryPointLite {
  file: string;
  line: number;
  package: string | null;
  className: string | null;
  runtime: string;
}

export type RuntimeStage =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

/** 后端真的跑通了的运行时。其余两个走显式降级分支（supported=false） */
const SUPPORTED: RuntimeKind[] = ['spring-boot'];

const VERDICT_TEXT: Record<ReconVerdict, string> = {
  match: '对得上',
  mismatch: '对不上',
  'not-run': '未执行',
};

/** 三档各有各的 class，且**字样本身就说清了档位** —— 不靠颜色单独承载语义 */
const VERDICT_CLASS: Record<ReconVerdict, string> = {
  match: 'text-brass',
  mismatch: 'text-fg',
  'not-run': 'text-fgMuted',
};

export default function RuntimePanel({
  entries,
  stage,
  run,
  onRun,
}: {
  entries: EntryPointLite[];
  stage: RuntimeStage;
  /** 这次采集对应第几个入口（-1 = 还没采过） */
  run: { entryIndex: number; probe: RuntimeProbeFact | null } | null;
  onRun: (entryIndex: number, runtime: RuntimeKind, wallClockMs: number) => void;
}) {
  const [picked, setPicked] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeKind>('spring-boot');
  const [wall, setWall] = useState(90);

  // 探针数组必须与 entryPoints **同下标**；没采的那几个位置放 null（= 没跑，不是跑挂了）
  const probes = useMemo(
    () => entries.map((_, i) => (run && run.entryIndex === i ? run.probe : null)),
    [entries, run]
  );
  const facts = useMemo(
    () => ({ code: { entryPoints: entries }, config: [] }) as never,
    [entries]
  );
  const recon = useMemo(() => reconcileRuntime(facts, probes), [facts, probes]);
  const groups = useMemo(() => groupByKind(recon.rows), [recon.rows]);

  const pickedEntry = entries[picked] ?? null;
  const busy = stage.kind === 'running';

  return (
    <div className="space-y-3">
      {/* ── 一、选入口 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、挑一个入口</p>
        <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
          主类名由你在这里点，<span className="text-fgMuted">后端不猜「该跑哪个类」</span>——
          猜错的表现是「起不来」，而项目真的起不来时也是「起不来」，这两种在结果上长得一样。
        </p>

        {entries.length === 0 ? (
          <p className="mt-2 text-[11px] leading-[17px] text-fgMuted">
            这次的静态事实里<span className="text-fg">没有登记到任何可运行入口</span>（@SpringBootApplication 或裸 main 都没扫到），
            所以活体解剖无从下手 —— 这是结论，不是空白。
            先去「架构面板」看入口识别，或换一个有 main 的工程。
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {entries.map((ep, i) => (
              <li key={`${ep.file}:${ep.line}:${i}`}>
                <button
                  type="button"
                  onClick={() => setPicked(i)}
                  className="flex w-full items-start gap-2 py-1.5 text-left"
                >
                  <span className="mono mt-px text-[10px] text-fgFaint">
                    {i === picked ? '●' : '○'}
                  </span>
                  <span className="flex-1">
                    <span className="mono text-[10.5px] text-fg">
                      {ep.className ?? '(类名缺失)'}
                    </span>
                    <span className="ml-1.5 text-[10px] text-fgMuted">runtime={ep.runtime}</span>
                    <span className="mono block text-[10px] text-fgFaint">
                      {ep.file}:{ep.line}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 二、真跑一次 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">二、真跑一次</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            {(['spring-boot', 'node-start', 'plain-main'] as RuntimeKind[]).map((r) => {
              const ok = SUPPORTED.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!ok}
                  onClick={() => setRuntime(r)}
                  title={ok ? '' : '后端目前只跑通了 spring-boot；点它会被明确拒掉，不是「还没接」'}
                  className={
                    'rounded px-2 py-0.5 text-[10.5px] transition-colors ' +
                    (runtime === r ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg') +
                    (ok ? '' : ' cursor-not-allowed opacity-40')
                  }
                >
                  {r}
                  {!ok && ' ·未跑通'}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-1 text-[10.5px] text-fgMuted">
            墙钟上限
            <input
              type="number"
              min={10}
              max={300}
              step={10}
              value={wall}
              onChange={(e) => setWall(Number(e.target.value))}
              className="mono w-16 rounded border border-line bg-transparent px-1.5 py-0.5 text-[10.5px] text-fg outline-none focus:border-lineHi"
            />
            秒
          </label>

          <button
            type="button"
            disabled={busy || entries.length === 0}
            onClick={() => onRun(picked, runtime, Math.min(300, Math.max(10, wall)) * 1000)}
            className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
          >
            {busy ? '采集中…' : '跑一次'}
          </button>
        </div>

        <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
          这一步会<span className="text-fgMuted">真的执行</span>上面那个入口的源码。后端把它复制到临时工作副本里跑，跑完删副本 ——
          你给的目录一个字节都不动。墙钟到了由沙箱杀整棵进程树，返回已经采到的部分并标
          <span className="text-fgMuted"> partial</span>，不会让你干等。
        </p>

        {stage.kind === 'failed' && (
          <p className="mt-1.5 text-[10.5px] leading-[15px] text-fgMuted">
            ⚠ 这次没采到（{stage.code}）：{stage.message}
            {stage.offline && ' —— 后端不在。这一页的其余结论全是「未执行」，不是「正常」。'}
          </p>
        )}
      </div>

      {/* ── 三、对账 ── */}
      <div className="panel px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">三、活体对账</p>
          <p className="mono text-[10px] text-fgFaint">
            对上 {recon.counts.match} · 对不上 {recon.counts.mismatch} · 未执行{' '}
            {recon.counts.notRun}
          </p>
        </div>

        <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">{recon.summary}</p>

        {recon.truncated && (
          <p className="mt-1.5 text-[10.5px] leading-[15px] text-fgMuted">
            ⚠ 输出被上限截断过，证据不完整 —— 下面每条结论都要按「只采到一部分」来读。
          </p>
        )}

        {groups.map((g) => (
          <div key={g.kind} className="mt-2.5">
            <p className="text-[11px] font-semibold text-fg">{g.label}</p>
            <ul className="mt-1 space-y-1">
              {g.rows.map((r, i) => (
                <li key={`${r.kind}-${i}`} className="rounded border border-line px-2 py-1.5">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mono shrink-0 text-[10px] ${VERDICT_CLASS[r.verdict]}`}
                    >
                      [{VERDICT_TEXT[r.verdict]}]
                    </span>
                    <span className="flex-1 text-[10.5px] leading-[15px] text-fgMuted">
                      {r.question}
                    </span>
                  </div>
                  <p className="mt-1 text-[10.5px] leading-[15px] text-fg">
                    {r.reason || '（对上了，所以没有要说清的问题）'}
                  </p>
                  <div className="mono mt-1 space-y-0.5 text-[10px] leading-[14px] text-fgFaint">
                    <p>静态：{evidenceText(r.staticEvidence)}</p>
                    <p>运行时：{evidenceText(r.runtimeEvidence)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {recon.notRunReasons.length > 0 && (
          <div className="mt-2.5">
            <p className="text-[11px] font-semibold text-fg">没跑/没对上的原因，原样列在这里</p>
            <ul className="mt-1 space-y-0.5">
              {recon.notRunReasons.map((r, i) => (
                <li key={i} className="text-[10.5px] leading-[15px] text-fgMuted">
                  · {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── 四、运行时原始事实 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          四、这次采集到的东西（原样，不加工）
        </p>
        {stage.kind === 'idle' || (!run && stage.kind !== 'running') ? (
          <p className="mt-1.5 text-[10.5px] leading-[15px] text-fgMuted">
            还没跑过 —— 上面三档现在全是「未执行」，那不是「一切正常」。
          </p>
        ) : busy ? (
          <p className="mt-1.5 text-[10.5px] leading-[15px] text-fgMuted">采集中，还没有结论。</p>
        ) : (
          <FactList run={run} picked={pickedEntry} />
        )}
      </div>
    </div>
  );
}

function FactList({
  run,
  picked,
}: {
  run: { entryIndex: number; probe: RuntimeProbeFact | null } | null;
  picked: EntryPointLite | null;
}) {
  const p = run?.probe ?? null;
  if (!p) {
    return (
      <p className="mt-1.5 text-[10.5px] leading-[15px] text-fgMuted">
        这一趟没有留下任何采集结果 —— 没采，不是采到了「没事」。
      </p>
    );
  }
  const rows: [string, string][] = [
    ['入口', `${picked?.className ?? '(类名缺失)'}（${p.mainClass ?? '后端没记主类名'}）`],
    ['运行时', `${p.runtime ?? '?'}${p.supported === false ? ' · 后端标为不支持' : ''}`],
    ['boot 版本', p.bootVersion ?? '没采到'],
    ['status', `${p.status ?? '?'}${p.reason ? ` —— ${p.reason}` : ''}`],
    [
      '进程',
      [
        p.process?.status ?? '?',
        p.process?.stoppedBy ? `（收尾方式：${p.process.stoppedBy}）` : '',
        p.process?.elapsedMs != null ? `${p.process.elapsedMs}ms` : '',
        p.process?.exitCode != null ? `退出码 ${p.process.exitCode}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [
      '端口',
      p.port?.value != null
        ? `${p.port.value}（来源：${p.port.source ?? '?'}${
            p.port.evidence?.line ? `，日志第 ${p.port.evidence.line} 行` : ''
          }）`
        : `没采到${p.port?.note ? ` —— ${p.port.note}` : ''}`,
    ],
    [
      'health',
      p.health
        ? `${p.health.endpoint ?? '/actuator/health'} → HTTP ${p.health.httpStatus ?? '?'}${
            p.health.body ? ` · ${p.health.body.slice(0, 80)}` : ''
          }${p.health.note ? `（${p.health.note}）` : ''}`
        : '这次采集里没有 health 段',
    ],
    ['墙钟', p.wallClockMs != null ? `${p.wallClockMs}ms` : '没记'],
    ['缺依赖', p.missingDeps?.length ? p.missingDeps.join('、') : '没报缺依赖'],
    ['输出行数', `stdout ${p.log?.stdoutLines ?? 0} · stderr ${p.log?.stderrLines ?? 0}`],
  ];
  return (
    <dl className="mt-1.5 space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="mono w-16 shrink-0 text-[10px] text-fgFaint">{k}</dt>
          <dd className="mono flex-1 text-[10px] leading-[14px] text-fgMuted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}