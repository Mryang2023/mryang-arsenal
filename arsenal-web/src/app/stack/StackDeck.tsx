'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dimensions } from '@/lib/stack';
import type { SlotState } from '@/lib/arch';
import type { StackPicks } from '@/lib/content-types';
import type { PicksProvenance } from '@/lib/picks-store';
import { clearProvenance } from '@/lib/picks-store';
import { DRAFTS_LIMIT } from './drafts';
import { TONE, INK, toneAt } from './palette';
import ProgressRing from './ProgressRing';
import { findOption } from './useStackChannel';
import { STEPS, STEP_BY_ID, groupOfDim, stepOfDim, type StepId } from './wizard';
import type { StackChannel } from './useStackChannel';

/**
 * 装配台的**常驻结论条**（顶部仪表）。
 *
 * 「这套组合能不能跑」不属于任何一步 —— 拆成四页之后它必须**四页都在**，
 * 否则这个第一问题就被藏进了某一屏。所以把它抽成一个组件：四页渲染同一份，
 * 而不是各抄一份。
 *
 * 它同时也是补齐回执 / 草稿 / 对比 / 分享这四个跨页动作的落点 ——
 * 它们答的都是「这套组合怎么样」，与当前停在第几步无关。
 */
export default function StackDeck({
  ch,
  focusDim,
}: {
  ch: StackChannel;
  /** 点阵与差异 chip 的直达回调：切步骤 + 聚焦 + 必要时跨页 */
  focusDim: (dimId: string) => void;
}) {
  const {
    picks, baseId, audit, statusMeta, tone, missingRequired, hazardCount,
    dotFlags, issueDots, activeDim, hist, undo, redo, fillNote, setFillNote,
    drafts, showDraftSave, setShowDraftSave, draftName, setDraftName,
    showDraftList, setShowDraftList, diffDraftId, setDiffDraftId,
    diffDraft, diffDims, copied, shareUrl, setShareUrl, provenance, setProvenance,
    openDraftSave, doSaveDraft, openDraftList, doDeleteDraft,
    doShare, fillRecommended, focusArch,
  } = ch;

  return (
    <>
      <div
        className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5"
        style={{ borderColor: tone.border, background: tone.soft }}
      >
        {/* 必选覆盖率环：三档结论（✓ 能跑 / ! 零件不全 / × 跑不起来）的量化面。
            tone 与三档同源 —— ring 的颜色就是结论的颜色，不另设一套。 */}
        <ProgressRing
          ratio={audit.stats.requiredTotal > 0 ? audit.stats.requiredFilled / audit.stats.requiredTotal : 0}
          tone={tone.color}
          size={44}
        />
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="mono flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[14px] leading-none"
            style={{ background: tone.soft, color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {audit.status === 'runnable' ? '✓' : audit.status === 'incomplete' ? '!' : '×'}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight" style={{ color: tone.color }}>
              {statusMeta.label}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
              {audit.status === 'broken' ? (
                <>
                  缺 <span style={{ color: TONE.bad.color }}>{missingRequired}</span> 个必需模块
                  {audit.blockers.length - missingRequired > 0 && (
                    <>
                      ，另有{' '}
                      <span style={{ color: TONE.bad.color }}>
                        {audit.blockers.length - missingRequired}
                      </span>{' '}
                      处能力没人提供
                    </>
                  )}
                  —— 这样的组合启动就会失败。
                </>
              ) : (
                <>
                  {statusMeta.summary}
                  {hazardCount > 0 && (
                    <>
                      　其中{' '}
                      <span style={{ color: TONE.warn.color }}>{hazardCount}</span> 条隐患已写明触发条件与现象。
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          {/* S2-2：一键补齐入口 —— 只在缺必需模块时出现。放结论条里是因为
              「哪里坏了」和「怎么修」必须出现在同一个视线里，跳走就断了。 */}
          {missingRequired > 0 && (
            <button
              type="button"
              onClick={fillRecommended}
              data-fill-cta=""
              className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: toneAt('warn', 0.6),
                background: toneAt('warn', 0.12),
                color: TONE.warn.color,
              }}
              title="把缺的必需模块按事实源推荐档补上；补了哪几块会列出来，一步可撤销"
            >
              按推荐补齐
            </button>
          )}
        </div>

        {/* 33 格点阵（S1-5）：每个格子 = 一个槽位 = dimensions 里的一维，
            颜色与卡片同规则（filled 绿 / conflict 黄 / missing-required 红虚线 /
            其余灰）。格子太小说明不了问题，所以带 title 与点击直达 ——
            它是结论的「哪儿不对」索引，不是装饰条。 */}
        <SlotDotMatrix
          slotStates={audit.slotStates}
          activeDim={activeDim}
          flags={dotFlags}
          issueItems={issueDots}
          onSelect={focusDim}
        />

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* 撤销 / 重做（S2-3）：数字是栈深；滑杆连续拖动合并为一步。
              回退到底后按钮禁用，不提供假按钮 */}
          <button
            type="button"
            onClick={undo}
            disabled={hist.undoSteps === 0}
            title="撤销 (Ctrl+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: INK.line, color: hist.undoSteps > 0 ? INK.muted : TONE.idle.color }}
          >
            ↶ {hist.undoSteps}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={hist.redoSteps === 0}
            title="重做 (Ctrl+Shift+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: INK.line, color: hist.redoSteps > 0 ? INK.muted : TONE.idle.color }}
          >
            ↷ {hist.redoSteps}
          </button>
          {/* 方案草稿（S2-6）：存当前组合 → 跟任意一份草稿比差异。
              键 arsenal-stack-drafts-v1 读写都在 drafts.ts，读方就在这里 ——
              只写不读的键不许存在（硬约定）。 */}
          <button
            type="button"
            onClick={openDraftSave}
            data-draft-cta=""
            title="把当前这套选型 + 形态 + 基底存成命名草稿"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={openDraftList}
            data-draft-list-cta=""
            aria-expanded={showDraftList}
            title="选一份已存的草稿，逐维度比差异"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            对比
          </button>
          <button
            type="button"
            onClick={doShare}
            data-share-cta=""
            title="把当前选型 + 形态 + 基底编码进链接（#s=…），发给谁都能一键还原"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            {copied ? '已复制' : '分享'}
          </button>
          <span className="mx-1 h-[16px] w-px bg-line" />
          <button
            type="button"
            onClick={focusArch}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: toneAt('warn', 0.6),
              background: toneAt('warn', 0.12),
              color: TONE.warn.color,
            }}
            title="把这套组合画成架构图：缺什么、请求怎么穿过、哪块有隐患，一眼看到；可下载 SVG / PNG 或复制 D2 / Mermaid 源码"
          >
            <span className="mono text-[12px] leading-none">⊞</span>
            看架构图
          </button>
          <Link
            href="/arch"
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            title="六大架构图谱：业务 / 数据 / 应用 / 技术 / 产品 / 项目"
          >
            <span className="mono text-[12px] leading-none">▣</span>
            六大架构
          </Link>
        </div>

        {/* S2-2 补齐回执：补了哪几块逐个列出（可核对），撤销一步回到补齐前。
            面板是 flex-wrap，w-full 让它独占第二行。任何后续选型改动都会清掉它。 */}
        {fillNote && fillNote.length > 0 && (
          <div
            data-fill-note=""
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5"
          >
            <span className="mono text-[11px] leading-none" style={{ color: TONE.ok.color }}>
              ✓
            </span>
            <p className="min-w-0 flex-1 text-2xs text-fgMuted">
              已按推荐补齐 <span className="mono text-fg">{fillNote.length}</span> 块：
              {fillNote.map((f) => `${f.dimName}=${f.optName}`).join(' · ')}
            </p>
            <button
              type="button"
              onClick={undo}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
              title="撤销本次补齐（等价 Ctrl+Z，一步回退）"
            >
              撤销补齐
            </button>
            <button
              type="button"
              onClick={() => setFillNote(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              知道了
            </button>
          </div>
        )}

        {/* S2-6 保存行：命名 + 确认。inline 展开而不是弹窗 —— 草稿是顺手动作，
            弹窗会把「存一下」变成一个任务。 */}
        {showDraftSave && (
          <div
            data-draft-save=""
            className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">存草稿</span>
            <input
              data-draft-name=""
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSaveDraft();
              }}
              maxLength={24}
              placeholder="给这套方案起个名"
              aria-label="草稿名称"
              autoFocus
              className="w-[180px] min-w-0 rounded-md border px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-fgFaint focus:border-brass"
              style={{ borderColor: INK.line, background: 'transparent', color: INK.pale }}
            />
            <button
              type="button"
              onClick={doSaveDraft}
              className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: toneAt('ok', 0.6),
                background: toneAt('ok', 0.12),
                color: TONE.ok.color,
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setShowDraftSave(false)}
              className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              取消
            </button>
            <span className="mono text-[10px] text-fgFaint">
              已存 {drafts.length}/{DRAFTS_LIMIT} 份，超出挤掉最旧
            </span>
          </div>
        )}

        {/* S2-6 草稿列表：选一份来比，或删掉不要的。 */}
        {showDraftList && (
          <div
            data-draft-list=""
            className="w-full border-t border-line pt-2.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">对比</span>
              <span className="text-[10px] text-fgFaint">选一份草稿，逐维度比差异</span>
            </div>
            {drafts.length === 0 ? (
              <p className="mt-1.5 text-2xs text-fgFaint">
                还没有草稿 —— 点「存草稿」把当前这套存下来。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      data-draft-item=""
                      onClick={() => {
                        setDiffDraftId(d.id);
                        setShowDraftList(false);
                      }}
                      className="min-w-0 flex-1 truncate rounded-md border border-line px-2 py-1 text-left text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                      title={`与当前组合比差异（存于 ${d.savedAt.slice(0, 10)}）`}
                    >
                      {d.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => doDeleteDraft(d.id)}
                      aria-label={`删除草稿 ${d.name}`}
                      className="mono shrink-0 rounded-md border border-line px-1.5 py-1 text-[10px] text-fgFaint transition-colors hover:border-lineHi hover:text-fg"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* S2-6 差异条：与草稿逐维度比。chip = 差异维度，点了直达那个槽位；
            title 里写「当前 → 草稿」两边各是什么，chip 本身保持一行短词。
            选型完全一致时明说「一致」，不渲染空 chip 列表。 */}
        {diffDraft && (
          <div
            data-diff-bar=""
            className="flex w-full flex-wrap items-center gap-1.5 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">对比</span>
            <p className="min-w-0 shrink-0 text-2xs text-fgMuted">
              与「{diffDraft.name}」差{' '}
              <span className="mono text-fg">{diffDims.length}</span> 处
              {diffDraft.baseId !== baseId ? '（基底也不同）' : ''}：
            </p>
            {diffDims.length === 0 ? (
              <span className="text-2xs text-fgMuted">选型完全一致</span>
            ) : (
              diffDims.map((d) => {
                const curName = picks[d.id] ? (findOption(d.id, picks[d.id])?.name ?? '未选') : '未选';
                const draftName2 = diffDraft.picks[d.id]
                  ? (findOption(d.id, diffDraft.picks[d.id])?.name ?? '未选')
                  : '未选';
                return (
                  <button
                    key={d.id}
                    type="button"
                    data-diff-chip=""
                    onClick={() => focusDim(d.id)}
                    title={`当前：${curName} / 草稿：${draftName2} —— 点击直达该槽位`}
                    className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] leading-[15px] text-fgMuted transition-colors hover:border-brass hover:text-fg"
                  >
                    {d.name}
                  </button>
                );
              })
            )}
            <button
              type="button"
              onClick={() => setDiffDraftId(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              收起
            </button>
          </div>
        )}

        {/* S3-3 剪贴板降级：clipboard API 不可用时给出可全选复制的输入行，
            链接照样能手工拿走 —— 静默失败等于「分享按钮是坏的」。 */}
        {shareUrl && (
          <div
            data-share-fallback=""
            className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              分享链接
            </span>
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="分享链接（点击全选复制）"
              className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[10px] outline-none focus:border-brass"
              style={{ borderColor: INK.line, background: 'transparent', color: INK.pale }}
            />
            <button
              type="button"
              onClick={() => setShareUrl(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              关闭
            </button>
          </div>
        )}
      </div>
      {/* ── 选型出处：这套选型是扫描读出来的，还是人点出来的 ───────
          一个槽位填着 redis，用户必须能问出「这是谁填的、凭什么」。
          扫描填的（有一行 pom.xml:47 做证据）和人手点的，可信度不是一回事。 */}
      {provenance && (
        <ProvenanceBanner
          provenance={provenance}
          picks={picks}
          onDismiss={() => {
            clearProvenance();
            setProvenance(null);
          }}
        />
      )}
    </>
  );
}

/**
 * 33 格槽位点阵（S1-5）。
 *
 * 一格 = 一个槽位 = dimensions 里的一维；颜色规则与零件卡**同一份映射**
 * （filled → ok / conflict → warn / missing-required → bad，其余 idle）——
 * 在这里另写一套颜色语义就违反「语义色只许 TONE 五色、含义不许复用」。
 *
 * 它回答的是「三档结论说不对，那到底哪儿不对」：一格一个槽位扫一眼，
 * 点击直达该槽位所在的步骤（交付件 ⑤、其余 ④ + 台面聚焦）。格数必须等于
 * dimensions.length —— 点阵不是装饰，少一格就有一个槽位没被索引到（【18】断言守着）。
 */
function SlotDotMatrix({
  slotStates,
  activeDim,
  flags,
  issueItems,
  onSelect,
}: {
  slotStates: Record<string, SlotState>;
  activeDim: string | null;
  /** 问题格：need = 在要没人给的能力 / 必选未装；remedy = 能补上缺口 */
  flags: Record<string, 'need' | 'remedy'>;
  /** 问题格的点名清单（与 flags 同源）：谁、什么问题 */
  issueItems: { dim: string; label: string; kind: 'need' | 'remedy' }[];
  onSelect: (dimId: string) => void;
}) {
  const STATE_LABEL: Record<SlotState, string> = {
    filled: '已装配',
    conflict: '参与组合隐患',
    'missing-required': '必选未装 —— 跑不起来',
    'missing-recommended': '建议件未装',
    empty: '可选未装',
  };
  const FLAG_META = {
    need: { color: TONE.bad.color, label: '有问题' },
    remedy: { color: TONE.ok.color, label: '可补' },
  } as const;
  const flagged = (Object.keys(flags) as string[]).filter((d) => flags[d]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="mono shrink-0 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
          {dimensions.length} 格
        </span>
        <div className="flex max-w-[272px] flex-wrap items-center gap-[3px]">
          {dimensions.map((d) => {
            const st = slotStates[d.id] ?? 'empty';
            const t =
              st === 'missing-required' ? TONE.bad
                : st === 'conflict' ? TONE.warn
                  : st === 'filled' ? TONE.ok
                    : TONE.idle;
            const dashed = st !== 'filled' && st !== 'conflict';
            const flag = flags[d.id];
            return (
              <button
                key={d.id}
                type="button"
                data-dim={d.id}
                data-state={st}
                onClick={() => onSelect(d.id)}
                title={
                  flag
                    ? `${d.name} · ${FLAG_META[flag].label}（点击直达该槽位）`
                    : `${d.name} · ${STATE_LABEL[st]}（点击直达该槽位）`
                }
                aria-label={`${d.name}：${flag ? FLAG_META[flag].label : STATE_LABEL[st]}`}
                className={
                  'h-[10px] w-[10px] rounded-sm border transition-transform hover:scale-125 ' +
                  (activeDim === d.id ? 'ring-1 ring-brass ring-offset-1 ring-offset-transparent' : '')
                }
                style={{
                  borderColor: flag ? FLAG_META[flag].color : t.border,
                  borderStyle: flag || !dashed ? 'solid' : 'dashed',
                  borderWidth: flag ? 2 : 1,
                  background: t.soft,
                  boxShadow: flag ? `0 0 0 1px ${FLAG_META[flag].color}55` : undefined,
                }}
              />
            );
          })}
        </div>
        {flagged.length > 0 && (
          <span className="mono shrink-0 text-[10px] leading-[15px] text-fgFaint">
            描边 = 有问题
          </span>
        )}
      </div>

      {/* 问题格文字索引：10px 色块说不清「这是哪格、坏在哪一步」，列出来直接点名。
          点击 = 定位到该槽位所在的步骤（交付件在 ⑤，其余在 ④ 台面并自动切流）。 */}
      {flagged.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {issueFlagOrder(flags).map((dimId) => {
            const kind = flags[dimId];
            const dim = dimensions.find((d) => d.id === dimId);
            const step = stepOfDim(dimId);
            const stepSpec = step ? STEP_BY_ID.get(step) : null;
            // 导航单位是「组」，维度挂在组下 —— 组名/维度名两级都给，
            // 否则「运行环境」在 ③ 导航上对不上号（导航列的是「运行基石」）
            const group = groupOfDim(dimId);
            const items = issueItems.filter((x: { dim: string }) => x.dim === dimId);
            const label = items.map((x) => x.label).join('、') || FLAG_META[kind].label;
            return (
              <button
                key={dimId}
                type="button"
                onClick={() => onSelect(dimId)}
                className="flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-[15px] transition-colors hover:brightness-125"
                style={{
                  borderColor: kind === 'need' ? TONE.bad.border : toneAt('ok', 0.5),
                  background: kind === 'need' ? TONE.bad.soft : toneAt('ok', 0.10),
                  color: kind === 'need' ? TONE.bad.color : TONE.ok.color,
                }}
                title={`${group ? `${group.name} / ` : ''}${dim?.name ?? dimId}（${
                  stepSpec ? `第 ${STEPS_ORDINAL(step!)} 步 · ${stepSpec.name} 配` : '④ 台面'
                }）→ 点击直达`}
              >
                <span className="font-medium">
                  {group ? `${group.name} / ` : ''}
                  {dim?.name ?? dimId}
                </span>
                <span className="text-fgMuted">{label}</span>
                {stepSpec && (
                  <span className="mono text-fgFaint">
                    {stepSpec.glyph} {stepSpec.name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 问题格在索引里的展示顺序：need（红）在前，remedy（绿）在后；同色按维度序 */
function issueFlagOrder(flags: Record<string, 'need' | 'remedy'>): string[] {
  return Object.keys(flags).sort((a, b) => {
    if (flags[a] !== flags[b]) return flags[a] === 'need' ? -1 : 1;
    return a.localeCompare(b);
  });
}

function STEPS_ORDINAL(stepId: StepId): number {
  // 序号出处是 wizard.STEPS，不在这里另抄一份顺序
  return STEPS.findIndex((s) => s.id === stepId) + 1;
}

export function Hint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-line bg-surface px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
      {text}
    </p>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-2xs text-fgFaint">{text}</p>
    </div>
  );
}

/**
 * 选型出处横幅。
 *
 * 三件事必须同时说清，缺一件这条横幅就退化成一块装饰：
 *   ① **从哪来** —— 仓库根路径与扫描时间；
 *   ② **凭什么** —— 每个槽位的出处（依赖坐标的文件:行号 / 部署清单文件名）；
 *   ③ **哪些不是它填的** —— 扫描之后被人改过的格子单独数出来。
 *
 * 少了 ③，用户会以为整张画布 33 格都是扫描读出来的；
 * 少了 ①②，就只剩一句「来自代码扫描」的空话。
 * 这三条的写法与「隐患必须带 trigger/symptoms/impact」是同一条规矩：
 * 给结论就得给出能核对它的东西。
 */
function ProvenanceBanner({
  provenance,
  picks,
  onDismiss,
}: {
  provenance: PicksProvenance;
  picks: StackPicks;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const edited = dimensions.filter(
    (d) => (provenance.atScan[d.id] ?? '') !== (picks[d.id] ?? '')
  );
  const editedDims = new Set(edited.map((d) => d.id));

  return (
    <section
      className="panel overflow-hidden"
      style={{ borderColor: toneAt('warn', 0.35), background: toneAt('warn', 0.05) }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <span className="mono text-[12px] leading-none" style={{ color: TONE.warn.color }}>
          ⌕
        </span>
        <p className="text-2xs text-fg">
          本次选型来自<span className="text-brass">代码扫描</span>
          <span className="mono ml-1.5 text-[10px] text-fgMuted">{provenance.root}</span>
        </p>
        <span className="mono text-[10px] text-fgFaint">
          {provenance.fromDeps.length} 格来自依赖声明
          {provenance.fromDeploy.length > 0 && ` · ${provenance.fromDeploy.length} 格来自部署清单`}
          {provenance.conflicts.length > 0 && ` · ${provenance.conflicts.length} 处同维冲突`}
          {provenance.unmatchedCount > 0 && ` · ${provenance.unmatchedCount} 项未识别`}
        </span>
        {edited.length > 0 && (
          <span className="mono text-[10px]" style={{ color: TONE.warn.color }}>
            其中 {edited.length} 格已被你改过
          </span>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
          >
            {open ? '收起出处' : '看出处'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
            title="清掉这条出处 —— 之后这套选型按手工拼装看待"
          >
            知道了
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-2.5">
          <ul className="space-y-1 text-[10px] leading-[15px] text-fgMuted">
            {provenance.fromDeps.map((d) => (
              <li key={`pv-dep-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint">
                  {' '}
                  ← {d.tech} · {d.path}:{d.line}
                </span>
                {editedDims.has(d.dim) && <span style={{ color: TONE.warn.color }}> · 已改动</span>}
              </li>
            ))}
            {provenance.fromDeploy.map((d) => (
              <li key={`pv-dp-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint"> ← 部署清单 {d.because}</span>
              </li>
            ))}
            {provenance.conflicts.map((c) => (
              <li key={`pv-cf-${c.dim}`} className="mono" style={{ color: TONE.warn.color }}>
                · {c.dim} 命中多个候选，取了 {c.kept}；另有 {c.dropped.join('、')} 未采用
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-fgFaint">
            未识别的依赖不会静默丢弃 —— 明细在
            <Link href="/arch" className="text-fgMuted underline underline-offset-2">
              「六大架构」页的代码扫描入口
            </Link>
            里逐条列出。
            {provenance.scannedAt && <>　扫描时间 {provenance.scannedAt}</>}
          </p>
        </div>
      )}
    </section>
  );
}
