'use client';

import { useMemo, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import { STATUS_META, type ArchAudit } from '@/lib/arch';
import {
  archDiagramD2,
  archDiagramMermaid,
  buildArchDiagram,
  toResponsiveSvg,
  type DiagramTheme,
} from '@/lib/arch-diagram';
import { projectDoc } from '@/lib/project';
import { downloadText } from '@/lib/zip';
import type { StackPicks } from '@/lib/content-types';

/**
 * 架构图页签。
 *
 * 这张图与导出包里的 `architecture.svg` 是同一个纯函数的两份产物，
 * 区别只在主题：屏幕上用暗色（和界面一致），文档里用浅色（多半在白底被看到）。
 * 所以这里给了一个切换 —— 你看到什么，下载到的就是什么。
 *
 * 没有引任何绘图库：层是固定的 6 条、槽位是固定的 17 个，坐标能直接算出来。
 * 引擎解决的是拓扑，而这里要的是版式。
 */
export default function ArchDiagram({ picks, audit }: { picks: StackPicks; audit: ArchAudit }) {
  const [theme, setTheme] = useState<DiagramTheme>('dark');
  const [note, setNote] = useState<string | null>(null);

  const built = useMemo(
    () =>
      buildArchDiagram({
        picks,
        audit,
        title: projectDoc.artifactId,
        subtitle: STATUS_META[audit.status].summary,
        theme,
      }),
    [picks, audit, theme]
  );

  const model = built.model;
  const slotCount = model.lanes.reduce((n, l) => n + l.slots.length, 0);
  const missingRequired = model.lanes
    .flatMap((l) => l.slots)
    .filter((s) => s.state === 'missing-required').length;

  /** SVG → PNG：借浏览器的 canvas。图里没有外部资源，不会污染画布，所以这条路是通的。 */
  async function downloadPng() {
    setNote(null);
    try {
      const blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG 无法解码'));
        img.src = url;
      });
      const scale = 2; // 2 倍图，贴进 Word / PPT 不至于糊
      const canvas = document.createElement('canvas');
      canvas.width = built.width * scale;
      canvas.height = built.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 canvas 上下文');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) {
          setNote('PNG 生成失败，请改用 SVG');
          return;
        }
        const pngUrl = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${projectDoc.artifactId}-architecture.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 4000);
        setNote(`已下载 PNG（${canvas.width}×${canvas.height}，2 倍图）`);
      }, 'image/png');
    } catch (e) {
      setNote(`PNG 生成失败：${e instanceof Error ? e.message : String(e)}，请改用 SVG`);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-fgMuted">
        横向色带是 6 层，方块是 17 个槽位；左侧竖直箭头表示请求自上而下穿过各层，
        层内的 <span className="mono">→</span> 是请求真正流经的顺序，竖虚线右侧是旁路件
        （只在发布期起作用，请求不经过它）。方块右上角的「必需 / 建议」是该槽位
        <span className="text-fg">留空时的性质</span>，不是当前状态。鼠标停在方块上能看到它的角色与代价。
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded border border-line p-0.5">
          {(
            [
              ['dark', '跟随界面'],
              ['light', '文档浅色'],
            ] as [DiagramTheme, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              className={
                'rounded px-2.5 py-1 text-2xs transition-colors ' +
                (theme === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setNote(
                `已下载 SVG（${built.width}×${built.height}，${
                  downloadText(built.svg, `${projectDoc.artifactId}-architecture.svg`, 'image/svg+xml')
                } 字节）`
              )
            }
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            下载 SVG
          </button>
          <button
            type="button"
            onClick={downloadPng}
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            下载 PNG
          </button>
          <CopyButton text={archDiagramD2(model)} label="复制 D2 源码" />
          <CopyButton text={archDiagramMermaid(model)} label="复制 Mermaid 源码" />
        </div>
      </div>

      {note && <p className="text-2xs text-brass">{note}</p>}

      {/* 图是文本拼出来的 SVG，内容全部由本仓库数据生成并按 XML 转义，没有外部输入 */}
      <div
        className="overflow-x-auto rounded-lg border border-line bg-canvas p-3"
        dangerouslySetInnerHTML={{ __html: toResponsiveSvg(built.svg) }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fgFaint">
        <span>
          {model.lanes.length} 层 · {slotCount} 槽位 · 图尺寸 {built.width}×{built.height}
          {missingRequired > 0 && (
            <span className="text-bad"> · {missingRequired} 个必需槽位空缺</span>
          )}
        </span>
        <span>
          导出包里的 <span className="mono">architecture.svg</span> 固定用浅色 —— 它在文档里被看；
          同目录还带 <span className="mono">ARCHITECTURE.md</span> 与{' '}
          <span className="mono">.d2 / .mermaid</span> 源码。
        </span>
      </div>
    </div>
  );
}
