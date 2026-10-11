'use client';

import { useState } from 'react';
import type { AutopsyArtifacts } from '@/lib/autopsy-data';
import { downloadText } from '@/lib/zip';

/**
 * 架构面板 —— 技术栈部署图 + 应用分层图。
 *
 * 两张图都来自 `buildAutopsy()` 同一份模型（分层图复用部署图的节点），
 * 所以不会出现「部署图说 MySQL、分层图说 Postgres」。
 * 本组件只负责**显示与下载**，不重新算图 —— 判据在 `facts-arch.ts` / `arch-canvas.ts`。
 */
export default function ArchPanel({
  artifacts,
  safeName,
}: {
  artifacts: AutopsyArtifacts;
  safeName: string;
}) {
  const [shown, setShown] = useState<'none' | 'tech' | 'layered'>('tech');
  const { built, layered } = artifacts;

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <DiagramCard
          title="技术栈部署图"
          desc={`${built.arch.nodes.length} 节点 / ${built.arch.edges.length} 连线 · 本地生成（不发往任何地方）`}
          active={shown === 'tech'}
          onToggle={() => setShown(shown === 'tech' ? 'none' : 'tech')}
          onDownload={() => downloadText(artifacts.techSvg, `${safeName}-deploy.svg`, 'image/svg+xml')}
        />
        <DiagramCard
          title="应用分层图"
          desc={
            `${layered.bands.length} 带 / ${layered.crossCalls.length} 处跨带直连 · 本地生成` +
            (layered.crossCalls.length ? '（跨带直连已在图上标红）' : '')
          }
          active={shown === 'layered'}
          onToggle={() => setShown(shown === 'layered' ? 'none' : 'layered')}
          onDownload={() =>
            downloadText(artifacts.layeredSvg, `${safeName}-layered.svg`, 'image/svg+xml')
          }
        />
      </div>

      {shown !== 'none' && (
        <div
          className="overflow-auto rounded border border-line bg-surface"
          dangerouslySetInnerHTML={{ __html: shown === 'tech' ? artifacts.techSvg : artifacts.layeredSvg }}
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
