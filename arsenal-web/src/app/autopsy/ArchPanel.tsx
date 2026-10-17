'use client';

import { useState } from 'react';
import type { AutopsyArtifacts } from '@/lib/autopsy-data';
import { downloadText } from '@/lib/zip';

/**
 * 架构面板 · 应用分层图。
 *
 * 「技术栈部署图」卡片已撤下（2026-10-17 架构图谱合并棒1）—— 它的职能由
 * 「技术架构」子页签的可拖拽画布承担：下载 SVG / PNG 在画布工具栏，
 * 副本徽章在画布上（读自部署清单，读不到不画、不兜底 1）。
 * 两张图仍来自 `buildAutopsy()` 同一份模型，不会出现「部署图说 MySQL、
 * 分层图说 Postgres」；本组件只负责**显示与下载**，不重新算图。
 *
 * 渲染形态（2026-10-14 二次定版，2026-10-17 沿用）：预览直接上 SVG 原图。
 * HTML 卡片视图试过一版被否 —— 图没了就不像图，回退。
 */
export default function ArchPanel({
  artifacts,
  safeName,
}: {
  artifacts: AutopsyArtifacts;
  safeName: string;
}) {
  const [open, setOpen] = useState(true);
  const { built, layered } = artifacts;

  return (
    <div className="space-y-2">
      <DiagramCard
        title="应用分层图"
        desc={
          `${layered.bands.length} 带 / ${layered.crossCalls.length} 处跨带直连 · 本地生成` +
          (layered.crossCalls.length ? '（跨带直连已在图上标红）' : '')
        }
        active={open}
        onToggle={() => setOpen((v) => !v)}
        onDownload={() =>
          downloadText(artifacts.layeredSvg, `${safeName}-layered.svg`, 'image/svg+xml')
        }
      />

      {open && (
        <div
          className="overflow-auto rounded border border-line bg-surface"
          dangerouslySetInnerHTML={{ __html: artifacts.layeredSvg }}
        />
      )}

      {/* 图上做过的自动决定 —— 副本数从哪读的、哪些证据缺行号，逐条列出来。
          不列的话「图上有 ×3」和「随便写了个 3」在页面上长得一模一样。 */}
      {built.notes.length > 0 && (
        <ul className="rounded border border-line px-2.5 py-2 text-[10.5px] leading-[16px] text-fgMuted">
          {built.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DiagramCard({
  title,
  desc,
  active,
  onToggle,
  onDownload,
}: {
  title: string;
  desc: string;
  active: boolean;
  onToggle: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="rounded border border-line px-2.5 py-2">
      <p className="text-[11.5px] font-semibold text-fg">{title}</p>
      <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">{desc}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          {active ? '收起' : '预览'}
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="rounded border px-2 py-0.5 text-[10.5px] transition-colors"
          style={{ borderColor: 'rgba(217,164,65,0.45)', color: '#D9A441' }}
        >
          下载 SVG
        </button>
      </div>
    </div>
  );
}
