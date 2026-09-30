'use client';

import { useEffect } from 'react';
import { DRAFTS_LIMIT, type StackDraft } from './drafts';
import { TONE } from './palette';

/**
 * 方案历史（交付中心底部面板）。
 *
 * 存的是**方案草稿**（`arsenal-stack-drafts-v1`：选型 + 形态 + 基底三通道快照），
 * 不是「导出记录」—— 本仓没有导出流水，拿草稿冒充导出历史是错话，所以这里
 * 就叫「方案历史」：存过的方案可以在这里一键恢复回台面、或删掉。
 *
 * ⚠️ 硬约定（S2-6 沿袭）：localStorage 键的持键方只有 `drafts.ts`，本组件
 * **不直接读写存储**，只消费已经由通道（useStackChannel）读出来的列表，
 * 恢复 / 删除也走通道里那两个既有函数。加第二个持键方等于埋一份会分叉的副本。
 *
 * 空态必须可见：入口藏起来会让人以为「根本没存过」或「这功能不存在」——
 * 保存入口在顶部结论条（存为方案），这里回答「存过什么、怎么取回来」。
 */
export default function DraftHistory({
  drafts,
  onReload,
  onRestore,
  onDelete,
}: {
  drafts: StackDraft[];
  /** 重新读一次存储（挂载时调一次；通道里 setDrafts 落盘后也会同步） */
  onReload: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // 挂载时读一次：列表是别的页面存下的，本页没有它的数据源
  useEffect(() => {
    onReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked = (d: StackDraft) => Object.values(d.picks).filter((v) => v && v !== 'none').length;

  return (
    <section className="panel overflow-hidden" data-draft-history="">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="mono text-[13px] leading-none text-brass">⎗</span>
        <h2 className="text-[13px] font-semibold leading-[18px] text-fg">方案历史</h2>
        <p className="text-[10px] leading-[15px] text-fgMuted">
          已存 <span className="mono">{drafts.length}</span> / {DRAFTS_LIMIT} 份方案草稿（选型 +
          形态 + 基底）—— 恢复即整份回灌台面，可用 Ctrl+Z 撤销。
        </p>
      </header>

      {drafts.length === 0 ? (
        <div className="px-4 py-3" data-draft-empty="">
          <p className="text-2xs leading-relaxed text-fgMuted">
            还没有存过方案 —— 在页面顶部结论条里点「存为方案」，存过的方案会出现在这里，
            随时可一键恢复或删掉。
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {drafts.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 px-4 py-2.5"
              data-draft-row={d.id}
            >
              <span className="min-w-0 flex-1 text-2xs text-fg">{d.name}</span>
              <span
                className="mono text-[10px] text-fgFaint"
                title={d.savedAt}
              >
                {d.savedAt.slice(5, 16).replace('T', ' ')}
              </span>
              <span className="mono text-[10px] text-fgFaint">
                {picked(d)} 维已选 · 基底 {d.baseId}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRestore(d.id)}
                  data-draft-restore={d.id}
                  className="mono rounded-md border px-2 py-1 text-[10px] transition-colors"
                  style={{ borderColor: TONE.ok.border, color: TONE.ok.color }}
                  title="把这整份方案（选型 + 形态 + 基底）恢复回台面；可 Ctrl+Z 撤销"
                >
                  恢复
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(d.id)}
                  data-draft-delete={d.id}
                  className="mono rounded-md border px-2 py-1 text-[10px] transition-colors"
                  style={{ borderColor: TONE.bad.border, color: TONE.bad.color }}
                  title="从 localStorage 里删掉这份草稿（不可撤销）"
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
