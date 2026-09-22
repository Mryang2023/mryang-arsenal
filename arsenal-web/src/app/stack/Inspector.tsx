'use client';

import { capLabel, capsOf, needsOf, nodeArch, STATUS_META } from '@/lib/arch';
import type { ArchAudit, ArchGap } from '@/lib/arch';
import type { StackOption, StackPicks } from '@/lib/content-types';
import type { StackPicksMeta } from '@/lib/topology';
import { dimensionById } from '@/lib/stack';
import GapCard from './GapCard';
import TopologyPicker from './TopologyPicker';
import { TONE } from './palette';

/**
 * 右侧装配面板。一栏两用：
 *   未选中模块 → 显示这套组合的体检结论（哪里断了、哪里只是缺件、哪里有隐患）
 *   选中模块   → 切换成该槽位的零件库，可换可拆
 *
 * 结论区只做分组和排序，单条隐患的呈现交给 GapCard ——
 * 因为同一份内容还要出现在「隐患体检单」页签里，两处必须长得一样。
 */
export default function Inspector({
  audit,
  activeDim,
  picks,
  meta,
  onPick,
  onClear,
  onTopology,
  onClose,
  onFocusDim,
}: {
  audit: ArchAudit;
  activeDim: string | null;
  picks: StackPicks;
  /** 形态与参数。形态不是「选项」的一部分，所以走单独一条通道 */
  meta: StackPicksMeta;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  onTopology: (dimId: string, modeId: string) => void;
  onClose: () => void;
  onFocusDim: (dimId: string) => void;
}) {
  // 注意：`meta` 这个标识符在本文件里有两个含义 ——
  //   ① 外层 prop `meta: StackPicksMeta`（形态与参数，要透传给 Picker）
  //   ② 这里的状态文案（STATUS_META[status]）
  // 两者同名过，TS 直接 `Cannot redeclare block-scoped variable`，而且 53 行
  // 会把状态文案当成形态数据传下去。状态文案一律叫 `statusMeta`。
  const statusMeta = STATUS_META[audit.status];
  const tone = TONE[
    statusMeta.tone === 'bad' ? 'bad' : statusMeta.tone === 'warn' ? 'warn' : 'ok'
  ];
  const total =
    audit.blockers.length + audit.gaps.length + audit.risks.length + audit.notes.length;

  return (
    <aside className="panel flex max-h-[calc(100vh-120px)] flex-col overflow-hidden lg:sticky lg:top-4">
      {activeDim ? (
        <Picker
          dimId={activeDim}
          picks={picks}
          meta={meta}
          onPick={onPick}
          onClear={onClear}
          onTopology={onTopology}
          onClose={onClose}
        />
      ) : (
        <>
          <div className="hairline-b px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span
                className="mono flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] leading-none"
                style={{ background: tone.soft, color: tone.color, border: `1px solid ${tone.border}` }}
              >
                {audit.status === 'runnable' ? '✓' : audit.status === 'incomplete' ? '!' : '×'}
              </span>
              <h2 className="text-[13px] font-semibold" style={{ color: tone.color }}>
                {statusMeta.label}
              </h2>
              <span className="mono ml-auto text-[10px] text-fgFaint">
                {total > 0 ? `${total} 条结论` : '无结论'}
              </span>
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{statusMeta.summary}</p>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="已装配" value={`${audit.stats.filled}/${audit.stats.total}`} />
              <Metric
                label="必选项"
                value={`${audit.stats.requiredFilled}/${audit.stats.requiredTotal}`}
                tone={audit.stats.requiredFilled < audit.stats.requiredTotal ? 'bad' : 'ok'}
              />
              <Metric
                label="隐患"
                value={`${audit.risks.length + audit.blockers.length}`}
                tone={audit.risks.length + audit.blockers.length > 0 ? 'bad' : 'ok'}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {total === 0 && (
              <p className="px-2 py-8 text-center text-2xs text-fgFaint">
                没有发现问题。零件齐全、能力闭环，也没有拼起来才会出现的隐患。
              </p>
            )}

            <Group
              title="跑不起来"
              hint="启动就会失败"
              tone="bad"
              items={audit.blockers}
              onFocusDim={onFocusDim}
            />
            <Group
              title="缺件"
              hint="能启动，但少能力"
              tone="warn"
              items={audit.gaps}
              onFocusDim={onFocusDim}
            />
            <Group
              title="组合隐患"
              hint="单独看都对，拼起来出事"
              tone="warn"
              items={audit.risks}
              onFocusDim={onFocusDim}
            />
            <Group
              title="提示"
              hint="知道就行"
              tone="info"
              items={audit.notes}
              onFocusDim={onFocusDim}
            />
          </div>
        </>
      )}
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'bad' ? '#E5484D' : tone === 'ok' ? '#7FA650' : '#E8F0EC';
  return (
    <div className="rounded-md border border-line bg-surfaceHi px-2 py-1.5">
      <div className="mono text-[15px] leading-tight" style={{ color }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-fgFaint">{label}</div>
    </div>
  );
}

const GROUP_TONE = { bad: TONE.bad, warn: TONE.warn, info: TONE.info } as const;

function Group({
  title,
  hint,
  tone,
  items,
  onFocusDim,
}: {
  title: string;
  hint: string;
  tone: 'bad' | 'warn' | 'info';
  items: ArchGap[];
  onFocusDim: (dim: string) => void;
}) {
  if (!items.length) return null;
  const t = GROUP_TONE[tone];
  return (
    <section className="border-t border-line pt-2.5 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <span className="mono text-[10px] uppercase tracking-wider" style={{ color: t.color }}>
          {title}
        </span>
        <span className="mono text-[10px] text-fgFaint">{items.length}</span>
        <span className="ml-auto text-[10px] text-fgFaint">{hint}</span>
      </div>
      <div className="space-y-2">
        {items.map((g, i) => (
          <GapCard key={`${g.title}-${i}`} gap={g} tone={tone} onFocus={onFocusDim} dense />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 零件库
// ─────────────────────────────────────────────────────────────

function Picker({
  dimId,
  picks,
  meta,
  onPick,
  onClear,
  onTopology,
  onClose,
}: {
  dimId: string;
  picks: StackPicks;
  meta: StackPicksMeta;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  onTopology: (dimId: string, modeId: string) => void;
  onClose: () => void;
}) {
  const dim = dimensionById.get(dimId);
  const node = nodeArch[dimId];
  if (!dim || !node) return null;

  const current = picks[dimId] || '';
  const currentOpt = dim.options.find((o) => o.id === current);

  return (
    <>
      <div className="hairline-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] leading-none text-brass">{node.icon}</span>
          <h2 className="text-[13px] font-semibold text-fg">{dim.name}</h2>
          {node.required && (
            <span
              className="mono rounded-sm px-1 text-[9px] leading-[14px]"
              style={{ color: '#E5484D', background: 'rgba(229,72,77,0.14)' }}
            >
              必选
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="mono ml-auto text-[12px] leading-none text-fgFaint hover:text-fg"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-[15px] text-fgMuted">{dim.why}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-line">
          {dim.options.map((o) => {
            const on = o.id === current;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onPick(dimId, o.id)}
                  className="w-full px-4 py-2.5 text-left transition-colors"
                  style={{ background: on ? 'rgba(127,166,80,0.07)' : undefined }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[9px] leading-none"
                      style={{
                        borderColor: on ? '#7FA650' : '#33413A',
                        color: on ? '#7FA650' : 'transparent',
                      }}
                    >
                      ✓
                    </span>
                    <span className="text-2xs font-medium text-fg">{o.name}</span>
                    {o.badge && (
                      <span className="mono ml-auto rounded-sm border border-line px-1 text-[9px] leading-[14px] text-fgFaint">
                        {o.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 pl-[21px] text-[10px] leading-[15px] text-fgMuted">
                    {o.summary}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-[21px]">
                    {capsOf(dimId, o.id).map((c) => (
                      <span
                        key={c}
                        className="mono rounded-sm px-1 text-[9px] leading-[14px]"
                        style={{ color: '#7FA650', background: 'rgba(127,166,80,0.10)' }}
                      >
                        +{capLabel(c)}
                      </span>
                    ))}
                    {needsOf(dimId, o.id).map((c) => (
                      <span
                        key={c}
                        className="mono rounded-sm px-1 text-[9px] leading-[14px]"
                        style={{ color: '#93A39C', background: 'rgba(255,255,255,0.04)' }}
                      >
                        需 {capLabel(c)}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {/* 形态选择器紧挨着零件库——选完零件，紧接着就是「几个实例、怎么摆」。
            它是这台装配台从「选组件」变成「装配一个项目」的那一步。 */}
        {currentOpt && (
          <TopologyPicker
            dimId={dimId}
            option={currentOpt}
            picks={picks}
            meta={meta}
            onPick={onTopology}
          />
        )}

        {currentOpt && <OptionDetail dimId={dimId} option={currentOpt} />}

        {current && (
          <div className="border-t border-line px-4 py-3">
            <button
              type="button"
              onClick={() => onClear(dimId)}
              className="w-full rounded-md border border-line py-1.5 text-2xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            >
              拆掉这一块（留空）
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function OptionDetail({ dimId, option }: { dimId: string; option: StackOption }) {
  const deps = (option.dependencies ?? []).filter((d) => d.groupId && d.artifactId);
  return (
    <div className="border-t border-line px-4 py-3">
      <p className="mono mb-2 text-[10px] uppercase tracking-wider text-fgFaint">
        当前零件的装配细节
      </p>

      <div className="space-y-2.5">
        {deps.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] text-fgFaint">引入的依赖</p>
            <ul className="space-y-0.5">
              {deps.map((d, i) => (
                <li key={i} className="mono text-[10px] leading-[15px] text-fgMuted">
                  {d.groupId}:{d.artifactId}
                </li>
              ))}
            </ul>
          </div>
        )}

        {option.yaml && (
          <div>
            <p className="mb-1 text-[10px] text-fgFaint">需要的配置</p>
            <pre className="mono overflow-x-auto rounded border border-line bg-canvas px-2 py-1.5 text-[10px] leading-[15px] text-fgMuted">
              {option.yaml}
            </pre>
          </div>
        )}

        {(option.configClasses ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-[10px] text-fgFaint">必需的配置类</p>
            <ul className="space-y-0.5">
              {(option.configClasses ?? []).map((c, i) => (
                <li key={i} className="text-[10px] leading-[15px] text-fgMuted">
                  <span className="mono text-brass">{c.className}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(option.pitfalls ?? []).length > 0 && (
          <div>
            <p className="mb-1 text-[10px] text-fgFaint">这一块最容易踩的坑</p>
            <ul className="space-y-1">
              {(option.pitfalls ?? []).map((p, i) => (
                <li key={i} className="flex gap-1.5 text-[10px] leading-[15px] text-fgMuted">
                  <span style={{ color: '#D9A441' }}>!</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
