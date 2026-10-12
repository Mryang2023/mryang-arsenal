import { useState } from 'react';
import type { ScanSource } from '@/lib/arsenal-api';
import {
  diffSnapshots,
  findingKey,
  fingerprintTrust,
  snapshotShapeIssues,
  type AutopsySnapshot,
  type SnapshotDiff,
} from '@/lib/autopsy-snapshot';
import { downloadText } from '@/lib/zip';

/**
 * 历史与对照。
 *
 * 三条不许含糊的话（每一条都在 UI 里原样出现，不许省）：
 *   ① **L2 增量未实现** —— 现在只做 L1：同一份输入再体检时直接复用上次结果，
 *      不会「只重扫变化的那几个文件」（那要先重构 CodeScanner 的聚合方式）。
 *   ② **指纹看不出什么** —— 浏览器侧指纹只比根目录名 / 文件数 / 字节数，
 *      「内容改了但规模没变」它会判成没变。这不是 bug，是取舍。
 *   ③ **「少了」必须有依据** —— 每一条「修好了」都带 `文件:行`，
 *      否则「P0 少了 2 个」和「2 条规则今天没跑」在页面上长得一模一样。
 */

export interface DamagedEntry {
  projectId: string;
  issues: string[];
}

export default function HistoryPanel({
  source,
  snapshots,
  damaged,
  diff,
  onDelete,
}: {
  source: ScanSource | null;
  snapshots: AutopsySnapshot[];
  damaged: DamagedEntry[];
  diff: SnapshotDiff | null;
  onDelete: (snapshotId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);

  const open = snapshots.find((s) => s.snapshotId === openId) ?? null;
  const base = snapshots.find((s) => s.snapshotId === compareId) ?? null;
  const picked: SnapshotDiff | null =
    open && base && base.snapshotId !== open.snapshotId ? diffSnapshots(base, open) : null;

  return (
    <div className="space-y-3">
      {/* ── 这次 vs 上次 ── */}
      {diff && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            对照：{diff.prevId} → {diff.nextId}
          </p>
          <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
            {diff.sameFingerprint
              ? '两次指纹一致（输入规模没变）—— 下面的差是规则集或快照口径变了，不是你改了代码。'
              : '两次指纹不同（根目录 / 文件数 / 字节数至少一项变了）。'}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fgMuted">
            <Delta label="P0" d={diff.p0} color="#E5484D" />
            <Delta label="P1" d={diff.p1} color="#E5A33D" />
            <span>
              覆盖率 <span className="text-fg">{diff.coveragePrev}</span> →{' '}
              <span className="text-fg">{diff.coverageNext}</span> / {diff.coverageTotal}
              {diff.coverageNext < diff.coveragePrev && (
                <span style={{ color: '#E5484D' }}>
                  {' '}
                  （少跑了 {diff.coveragePrev - diff.coverageNext} 条 —— 这不是变好了）
                </span>
              )}
            </span>
            <span>
              观察项 <span className="text-fg">{diff.obsPrev}</span> →{' '}
              <span className="text-fg">{diff.obsNext}</span>
            </span>
          </div>
          <FindingsDelta label="P0 新增" items={diff.p0.added} color="#E5484D" />
          <FindingsDelta label="P0 已修（上次有、这次没有）" items={diff.p0.fixed} color="#7FA650" />
          <FindingsDelta label="P1 新增" items={diff.p1.added} color="#E5A33D" />
          <FindingsDelta label="P1 已修" items={diff.p1.fixed} color="#7FA650" />
        </div>
      )}

      {/* ── 列表 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          历史快照（{snapshots.length} 份）
        </p>

        {!source && (
          <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
            上面还没填地址 —— 先填一个再看这份地址的历史。
          </p>
        )}

        {source && snapshots.length === 0 && (
          <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
            这个地址还没有任何快照。跑一次体检就会自动留一份 ——
            <span className="text-fg"> 没有历史与「历史被清空了」是两件事，这里说的是前者</span>
            ：本机浏览器 localStorage 里一条都没有。
          </p>
        )}

        {snapshots.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {snapshots.map((s) => {
              const isOpen = openId === s.snapshotId;
              return (
                <li key={s.snapshotId} className="py-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : s.snapshotId)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-[11px]"
                  >
                    <span className="mono text-fg">{s.snapshotId}</span>
                    <span className="mono text-fgFaint" title={s.fingerprint}>
                      {s.fingerprint.slice(0, 8)}
                    </span>
                    <span className="text-fgMuted">{s.root}</span>
                    <span style={{ color: '#E5484D' }}>P0 {s.verdict.p0}</span>
                    <span style={{ color: '#E5A33D' }}>P1 {s.verdict.p1}</span>
                    <span className="text-fgMuted">other {s.verdict.other}</span>
                    <span className="text-fgMuted">观察 {s.verdict.obs}</span>
                    <span className="text-fgMuted">
                      覆盖 {s.coverage.executed}/{s.coverage.total}
                    </span>
                    {s.scope?.truncated && (
                      <span style={{ color: '#E5A33D' }}>被闸门截断，事实不完整</span>
                    )}
                    {!fingerprintTrust(s.report).trustworthy && (
                      <span style={{ color: '#E5A33D' }} title={fingerprintTrust(s.report).reason}>
                        指纹不可信，不会被复用
                      </span>
                    )}
                    <span className="ml-auto text-fgFaint">{isOpen ? '收起' : '展开'}</span>
                  </button>

                  {isOpen && (
                    <div className="mt-1.5 space-y-2 rounded border border-line px-2.5 py-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-fgFaint">
                        <span>
                          来源 <span className="mono text-fgMuted">{s.source.kind}</span>{' '}
                          <span className="mono text-fgMuted">{s.source.value}</span>
                        </span>
                        <span>存于 {s.savedAt}</span>
                        <span>耗时 {s.elapsedMs} ms</span>
                        <span>
                          {s.scope.files} 文件 / {(s.scope.bytes / 1024).toFixed(0)} KB
                        </span>
                        <span>未覆盖 {s.coverage.notRun} 条</span>
                        {s.factsOmitted && (
                          <span style={{ color: '#E5A33D' }}>
                            架构事实未存（当时为省配额丢掉了，结论完整）
                          </span>
                        )}
                      </div>

                      <p className="text-[10px] leading-[15px] text-fgFaint">
                        指纹口径：<span className="mono">{s.fingerprintKind}</span> ——{' '}
                        {s.fingerprintKind === 'report'
                          ? '只比根目录名 / 文件数 / 字节数，同尺寸的改动一定漏检。'
                          : '见 autopsy-fingerprint.mjs 的口径说明。'}
                      </p>

                      {(['p0', 'p1', 'other'] as const).map((tier) => {
                        const list = s.report[tier] ?? [];
                        if (list.length === 0) return null;
                        return (
                          <div key={tier}>
                            <p className="mono text-[10px] text-fgMuted">
                              {tier.toUpperCase()} {list.length} 条
                            </p>
                            <ul className="mt-1 space-y-0.5 text-[10px] leading-[15px] text-fgMuted">
                              {list.slice(0, 20).map((f) => (
                                <li key={findingKey(f)} className="mono">
                                  <span
                                    style={{
                                      color:
                                        tier === 'p0'
                                          ? '#E5484D'
                                          : tier === 'p1'
                                            ? '#E5A33D'
                                            : '#93A39C',
                                    }}
                                  >
                                    {f.ruleId}
                                  </span>{' '}
                                  {f.title} ← {f.evidence}
                                </li>
                              ))}
                              {list.length > 20 && (
                                <li className="text-fgFaint">…另 {list.length - 20} 条未列出</li>
                              )}
                            </ul>
                          </div>
                        );
                      })}

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadText(
                              JSON.stringify(s, null, 2),
                              `${s.root || 'project'}-${s.snapshotId}.json`,
                              'application/json'
                            )
                          }
                          className="rounded border border-line px-2 py-0.5 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                        >
                          下载这份快照
                        </button>
                        <button
                          type="button"
                          onClick={() => setCompareId(s.snapshotId)}
                          className="rounded border border-line px-2 py-0.5 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                        >
                          设为对照基线
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onDelete(s.snapshotId);
                            setOpenId(null);
                          }}
                          className="rounded border border-line px-2 py-0.5 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                        >
                          删除
                        </button>
                      </div>

                      {picked && (
                        <div className="rounded border border-line px-2 py-1.5 text-[10px] text-fgMuted">
                          <p className="mono text-fgFaint">
                            与 {base?.snapshotId} 比：P0 {picked.p0.prev}→{picked.p0.next}（新增{' '}
                            {picked.p0.added.length} / 已修 {picked.p0.fixed.length}），P1{' '}
                            {picked.p1.prev}→{picked.p1.next}（新增 {picked.p1.added.length} / 已修{' '}
                            {picked.p1.fixed.length}）
                          </p>
                          <FindingsDelta label="新增" items={picked.p0.added} color="#E5484D" />
                          <FindingsDelta label="已修" items={picked.p0.fixed} color="#7FA650" />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {damaged.length > 0 && (
          <div
            className="mt-2 rounded border px-2.5 py-2"
            style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
          >
            <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
              有 {damaged.length} 份快照坏了（已跳过，没有让整页挂掉）
            </p>
            <ul className="mt-1 space-y-0.5 text-[10px] leading-[15px] text-fgMuted">
              {damaged.map((d, i) => (
                <li key={`${d.projectId}-${i}`} className="mono">
                  {d.projectId} —— {d.issues.join('；')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          这条路的边界（不许含糊）
        </p>
        <ul className="mt-1.5 space-y-1 text-[10px] leading-[16px] text-fgMuted">
          <li>
            · <span className="text-fg">L2 增量未实现。</span> 现在只会「整份复用」或「整份重扫」，
            不会只重算变化的文件 —— 那需要先重构 <span className="mono">CodeScanner</span>{' '}
            的聚合方式，是独立改造。
          </li>
          <li>
            · 浏览器侧指纹只比<span className="mono"> 根目录名 / 文件数 / 字节数</span>
            ——内容改了但三者都没变时会被判成「没变」。真·树指纹（mtime+size）在 Node 侧
            <span className="mono"> autopsy-fingerprint.mjs</span>，浏览器读不到目录，做不到。
          </li>
          <li>
            · 快照存在本机浏览器 localStorage 里，<span className="text-fg">不进军火库仓库</span>
            （与 /arch 的导入档案同一条规矩）。换浏览器 / 清缓存即消失，长期留档请用「下载快照」。
          </li>
        </ul>
      </div>
    </div>
  );
}

function Delta({
  label,
  d,
  color,
}: {
  label: string;
  d: { prev: number; next: number; added: unknown[]; fixed: unknown[] };
  color: string;
}) {
  const flat = d.next === d.prev;
  return (
    <span>
      <span style={{ color }}>{label}</span> <span className="text-fg">{d.prev}</span> →{' '}
      <span className="text-fg">{d.next}</span>
      {!flat && (
        <span className="text-fgFaint">
          {' '}
          （新增 {d.added.length} / 消失 {d.fixed.length}）
        </span>
      )}
      {flat && <span className="text-fgFaint"> （无变化）</span>}
    </span>
  );
}

/** 「少了」必须能点开看见是哪一条 —— 只有数字的话它和「规则没跑」长得一模一样 */
function FindingsDelta({
  label,
  items,
  color,
}: {
  label: string;
  items: { ruleId: string; title: string; evidence: string }[];
  color: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="text-[10px]" style={{ color }}>
        {label} {items.length} 条
      </p>
      <ul className="mt-0.5 space-y-0.5 text-[10px] leading-[15px] text-fgMuted">
        {items.slice(0, 10).map((f, i) => (
          <li key={`${f.ruleId}-${f.evidence}-${i}`} className="mono">
            {f.ruleId} {f.title} ← {f.evidence}
          </li>
        ))}
        {items.length > 10 && <li className="text-fgFaint">…另 {items.length - 10} 条</li>}
      </ul>
    </div>
  );
}
