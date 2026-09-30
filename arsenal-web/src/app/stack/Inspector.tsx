'use client';

import { capLabel, capsOf, needsOf, nodeArch, STATUS_META } from '@/lib/arch';
import type { ArchAudit, ArchGap } from '@/lib/arch';
import type { StackDimension, StackOption, StackPicks } from '@/lib/content-types';
import { dimensionById } from '@/lib/stack';
import GapCard from './GapCard';
import RuleHits from './RuleHits';
import { TONE, INK, toneAt, gloss } from './palette';

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
  baseId,
  onPick,
  onClear,
  onClose,
  onFocusDim,
}: {
  audit: ArchAudit;
  activeDim: string | null;
  picks: StackPicks;
  /** 技术栈基底（S3-4 规则联动按它算 Java/Spring key） */
  baseId: string;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  onClose: () => void;
  onFocusDim: (dimId: string) => void;
}) {
  // 注意：`meta` 这个标识符在本文件里曾有多个含义 ——
  //   ① 外层 prop `meta: StackPicksMeta`（形态与参数，透传给 Picker）
  //   ② 这里的状态文案（STATUS_META[status]）
  // 两者同名过，TS 直接 `Cannot redeclare block-scoped variable`。状态文案一律叫
  // `statusMeta`。09-28 七反馈起部署形态只在 ⑥ 表态，Picker 不再收 meta/onTopology。
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
          onPick={onPick}
          onClear={onClear}
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

            {/* S3-4 规则联动：这套组合牵动的规则（选型层逐条、基底层收成一行），
                换件实时变；id 来自 rules.json，/rules/<id> 必然存在。 */}
            <RuleHits picks={picks} baseId={baseId} />
          </div>
        </>
      )}
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  const color = tone === 'bad' ? TONE.bad.color : tone === 'ok' ? TONE.ok.color : INK.fg;
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

/**
 * 零件库（④ 选件抽屉的内容体）。
 *
 * 头部（icon + 槽位名 + 必选标 + ×）与滚动内容区都假设父容器是
 * `flex flex-col` 的全高面板 —— 抽屉壳（DimDrawer）与旧右栏 aside 都是这种形状。
 *
 * 09-28 七反馈：部署形态从零件库摘除 —— ④ 只回答「装什么」，几个实例、
 * 怎么摆在 ⑥ 部署形态一处表态（TopologyStep 会列出全部已装的带形态零件），
 * 两处各养一份入口必然「改一处忘一处」。
 */
export function Picker({
  dimId,
  picks,
  onPick,
  onClear,
  onClose,
}: {
  dimId: string;
  picks: StackPicks;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
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
              className="mono rounded-sm px-1 text-[10px] leading-[15px]"
              style={{ color: TONE.bad.color, background: toneAt('bad', 0.14) }}
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
        <OptionList dimId={dimId} current={current} onPick={onPick} />

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

/**
 * 就地换件 / 零件库共用的候选排序（S2-1）。
 *
 * 「按推荐排」的数据出处是事实源的 `defaultOption`，不是这里另打分：
 * 推荐档（且不是「不用 X」）排最前，其余按事实源原序，「不用 X」永远垫底 ——
 * 它是退出项，不是候选，排中间会诱导误点。
 */
export function recommendedOrder(dim: StackDimension): StackOption[] {
  const head = dim.options.find((o) => o.id === dim.defaultOption && o.id !== 'none');
  const none = dim.options.find((o) => o.id === 'none');
  const rest = dim.options.filter((o) => o.id !== 'none' && o.id !== dim.defaultOption);
  return [...(head ? [head] : []), ...rest, ...(none ? [none] : [])];
}

/**
 * 选项行的一份渲染（S2-1）：右栏零件库（Picker）与卡片上的就地换件菜单
 * 都吃它 —— 两处各养一份 <li> 模板必然漂移（改一处忘一处）。
 */
export function OptionList({
  dimId,
  current,
  onPick,
}: {
  dimId: string;
  /** 当前选中的选项 id；'' = 未选 */
  current: string;
  onPick: (dimId: string, optId: string) => void;
}) {
  const dim = dimensionById.get(dimId);
  if (!dim) return null;
  return (
    <ul className="divide-y divide-line">
      {recommendedOrder(dim).map((o) => {
        const on = o.id === current;
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick(dimId, o.id)}
              className="w-full px-4 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brass"
              style={{ background: on ? toneAt('ok', 0.07) : undefined }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
                  style={{
                    borderColor: on ? TONE.ok.color : INK.dim,
                    color: on ? TONE.ok.color : 'transparent',
                  }}
                >
                  ✓
                </span>
                <span className="text-2xs font-medium text-fg">{o.name}</span>
                {o.badge && (
                  <span className="mono ml-auto rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint">
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
                    className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                    style={{ color: TONE.ok.color, background: toneAt('ok', 0.10) }}
                  >
                    +{capLabel(c)}
                  </span>
                ))}
                {needsOf(dimId, o.id).map((c) => (
                  <span
                    key={c}
                    className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                    style={{ color: INK.muted, background: gloss(0.04) }}
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
                  <span style={{ color: TONE.warn.color }}>!</span>
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
