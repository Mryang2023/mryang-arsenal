'use client';

import { useMemo, useState } from 'react';
import { TECH_ICONS, iconSvg } from '@/lib/tech-icons';
import {
  ICON_CATEGORIES,
  categoryMeta,
  iconAssetColor,
  iconAssets,
  iconStats,
  searchIcons,
} from '@/lib/icon-assets';
import type { IconAsset } from '@/lib/content-types';

type Mode = 'vector' | 'bitmap';

/**
 * 图标库主界面。
 *
 * 两个视图不是同一张图的两种尺寸，而是**两套资产**：
 *   矢量 —— 架构图节点、装配台、IR 组件真正用的那一套，能换色、能进 SVG 导出；
 *   位图 —— 卡片配图与文档插图用的那一套，有质感但换不了色。
 * 把这两件事分开显示，是为了让人一眼看出「我现在拿走的这份能用在哪种地方」，
 * 而不是拿到一张 PNG 去贴架构图（贴上去换环境就成白块）。
 *
 * 位图没生成的图标不假装存在：矢量照常显示，位图位显示「未生成」，
 * 并给出可以直接拿去生图的 prompt —— 空态也是信息，不是故障。
 */

function VectorPreview({ asset, size }: { asset: IconAsset; size: number }) {
  const color = iconAssetColor(asset);
  const svg = iconSvg(asset.vector, 0, 0, size);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ color }}
    />
  );
}

/** 把矢量导出成一份可独立打开的 .svg —— 交付文档里插图就是这么来的 */
function downloadVector(asset: IconAsset) {
  const color = iconAssetColor(asset);
  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ` +
    `style="color:${color}">${TECH_ICONS[asset.vector]?.svg ?? ''}</svg>`;
  const blob = new Blob([body], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${asset.key}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function IconGallery() {
  const [q, setQ] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('vector');
  const [picked, setPicked] = useState<string[]>([]);
  const [copied, setCopied] = useState('');

  const list = useMemo(() => {
    const hit = searchIcons(q);
    return cats.length ? hit.filter((i) => cats.includes(i.category)) : hit;
  }, [q, cats]);

  const toggleCat = (id: string) =>
    setCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const togglePick = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('复制失败（浏览器拒绝了剪贴板）');
    }
  };

  const pickedAssets = iconAssets.filter((i) => picked.includes(i.key));

  const markdownRef = pickedAssets
    .map((a) =>
      a.bitmap
        ? `![${a.name}](/icons/${a.bitmap})`
        : `\`${a.key}\` ${a.name}`
    )
    .join('\n');

  const jsonRef = JSON.stringify(
    pickedAssets.map((a) => ({ key: a.key, name: a.name, category: a.category, vector: a.vector, bitmap: a.bitmap })),
    null,
    2
  );

  const styleNote = (a: IconAsset) =>
    `flat vector icon, software architecture diagram symbol, thin uniform 2px stroke, single accent color ${categoryMeta(a.category).accent}, plain white background, centered, no text, no letters, no numbers, minimal, technical, 512x512 — subject: ${a.subject}`;

  return (
    // pb-24：底部对比条是 fixed，只有选中过图标才出现。没有这层留白，
    // 最后一排卡片会被压住 —— 表现为「点最下面一排的图标点不准 / 浮出层钻到条下面」。
    <div className={`space-y-5 ${picked.length > 0 ? 'pb-24' : ''}`}>
      {/* ── 工具条 ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fgFaint">
            ⌕
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜 key / 中文名 / 英文名 / 标签 —— 例如 缓存、nacos、lb"
            className="w-full rounded-md border border-line bg-surface py-2 pl-8 pr-3 text-[13px] text-fg placeholder:text-fgFaint focus:border-brass focus:outline-hidden"
          />
        </div>

        <div className="flex overflow-hidden rounded-md border border-line">
          {(['vector', 'bitmap'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-3 py-2 text-[12px] transition-colors"
              style={{
                background: mode === m ? 'rgba(217,164,65,0.12)' : 'transparent',
                color: mode === m ? '#D9A441' : '#93A39C',
              }}
            >
              {m === 'vector' ? '矢量（架构图用）' : '位图（插图用）'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setCats([])}
          className="rounded-md border border-line px-3 py-2 text-[12px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          清空筛选
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-[196px_1fr]">
        {/* ── 分类侧栏 ─────────────────────────────────────── */}
        <aside className="space-y-1">
          <div className="mb-2 px-1 text-2xs uppercase tracking-[0.16em] text-fgFaint">分类</div>
          {ICON_CATEGORIES.map((c) => {
            const n = iconAssets.filter((i) => i.category === c.id).length;
            const on = cats.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCat(c.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors"
                style={{
                  background: on ? 'rgba(217,164,65,0.09)' : 'transparent',
                  color: on ? '#E8F0EC' : '#93A39C',
                  borderLeft: `2px solid ${on ? c.accent : 'transparent'}`,
                }}
                title={c.desc}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: c.accent }}
                />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="mono text-2xs text-fgFaint">{n}</span>
              </button>
            );
          })}
          <div className="mt-3 rounded-md border border-line bg-surface px-3 py-3 text-2xs leading-relaxed text-fgFaint">
            <div className="flex justify-between py-0.5">
              <span>登记图标</span>
              <span className="mono text-fgMuted">{iconStats.total}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>位图已生成</span>
              <span className="mono text-fgMuted">{iconStats.bitmaps}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span>矢量缺失</span>
              <span className="mono" style={{ color: iconStats.missingVector ? '#E5484D' : '#7FA650' }}>
                {iconStats.missingVector}
              </span>
            </div>
          </div>
        </aside>

        {/* ── 主区网格 ─────────────────────────────────────── */}
        <section>
          {list.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface px-6 py-10 text-center">
              <p className="text-[14px] text-fg">没有匹配的图标</p>
              <p className="mx-auto mt-2 max-w-lg text-[12.5px] leading-relaxed text-fgMuted">
                这件事本身是允许的：图标库是分批补的，缺的那张可以现在就生成。
                下面是拼好的生图 prompt（风格前缀 + 主体），粘给生图工具即可。
                产出一张 1024 的方图后，缩到 512 落
                <span className="mono text-fg"> public/icons/&lt;分类&gt;/&lt;key&gt;.png</span>
                ，再到 <span className="mono text-fg">tools/content/icons.py</span> 的
                <span className="mono text-fg">BITMAPS</span> 表里登记一行（key → 路径），
                跑 <span className="mono text-fg">build-content.py</span> 与
                <span className="mono text-fg">sync-content.mjs</span> 就完成一轮。
                为什么必须缩：图标库的体积闸门是**全库 ≤6MB**，1024 原图一张就 200KB。
              </p>
              <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-canvas px-4 py-3 text-left text-2xs leading-relaxed text-fgMuted">
                {`flat vector icon, software architecture diagram symbol, thin uniform 2px stroke,\nsingle accent color {accent}, plain white background, centered, no text, no letters,\nno numbers, no watermark, minimal, technical, 512x512\n\nsubject: ${q || '<你要画的东西>'}`}
              </pre>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((a) => {
                const color = iconAssetColor(a);
                const on = picked.includes(a.key);
                return (
                  <div
                    key={a.key}
                    className="group relative rounded-lg border bg-surface transition-colors"
                    style={{
                      borderColor: on ? 'rgba(217,164,65,0.55)' : '#243029',
                      background: on ? 'rgba(217,164,65,0.05)' : undefined,
                    }}
                  >
                    <button
                      onClick={() => togglePick(a.key)}
                      className="flex w-full flex-col items-center gap-2 px-3 pb-3 pt-4"
                      title={`${a.name} / ${a.en}`}
                    >
                      <span
                        className="flex h-[76px] w-[76px] items-center justify-center rounded-md"
                        style={{ background: 'rgba(255,255,255,0.03)' }}
                      >
                        {mode === 'vector' ? (
                          <VectorPreview asset={a} size={56} />
                        ) : a.bitmap ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={`/icons/${a.bitmap}`} alt={a.name} width={56} height={56} />
                        ) : (
                          <span className="text-2xs text-fgFaint">位图未生成</span>
                        )}
                      </span>
                      <span className="w-full text-center text-[12.5px] text-fg">{a.name}</span>
                      <span className="mono w-full truncate text-center text-2xs text-fgFaint">
                        {a.key}
                      </span>
                    </button>

                    {/* 悬停浮出的两行信息与两个动作。
                        z-30 是必须的：这张卡是 absolute 定位但默认 z-index:auto，
                        grid 里排在后面的兄弟卡片会按文档顺序画在它上面，把浮出层盖掉
                        （表现就是「选中后卡片下方的信息被下面一排图标压住」）。
                        取 30 而不是 20：底部对比条是 fixed z-20，最后一排的浮出层要压过它。 */}
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 translate-y-full rounded-b-lg border border-t-0 border-line bg-surfaceHi px-3 py-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                      style={{ borderColor: '#243029' }}
                    >
                      <div className="truncate text-2xs text-fgMuted">{a.en}</div>
                      <div className="mono truncate text-2xs" style={{ color }}>
                        {categoryMeta(a.category).name}
                      </div>
                      <div className="mt-1.5 flex gap-1">
                        <button
                          onClick={() => copy(a.key, `已复制 ${a.key}`)}
                          className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted hover:border-lineHi hover:text-fg"
                        >
                          复制 key
                        </button>
                        <button
                          onClick={() => downloadVector(a)}
                          className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted hover:border-lineHi hover:text-fg"
                        >
                          下 SVG
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {list.length > 0 && mode === 'bitmap' && iconStats.bitmaps < iconStats.total && (
            <p className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-[12px] leading-relaxed text-fgMuted">
              {iconStats.bitmaps === 0
                ? '位图一张都还没生成'
                : `位图正在分批补：已有 ${iconStats.bitmaps} / ${iconStats.total} 张，剩下的还是空态`}
              {' —— 这是已知状态，不是故障。'}矢量已经全部就位，架构图能直接用；
              补图流程：生图 → 缩到 512 方图落
              <span className="mono text-fg"> public/icons/&lt;分类&gt;/&lt;key&gt;.png</span>
              → 在 <span className="mono text-fg">tools/content/icons.py</span> 的
              <span className="mono text-fg">BITMAPS</span> 表里登记一行，再跑两条同步。
            </p>
          )}
        </section>
      </div>

      {/* ── 底部对比条 ─────────────────────────────────────── */}
      {picked.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surfaceHi/95 px-5 py-3 backdrop-blur"
          style={{ borderColor: '#243029' }}
        >
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[12.5px] text-fg">
              已选 <span className="mono text-brass">{picked.length}</span> 个
            </span>
            <span className="flex -space-x-1">
              {pickedAssets.slice(0, 12).map((a) => (
                <span
                  key={a.key}
                  className="flex h-6 w-6 items-center justify-center rounded border border-line bg-surface"
                  style={{ color: iconAssetColor(a) }}
                  title={a.name}
                  dangerouslySetInnerHTML={{ __html: iconSvg(a.vector, 0, 0, 16) }}
                />
              ))}
              {picked.length > 12 && (
                <span className="flex h-6 items-center rounded border border-line bg-surface px-1 text-2xs text-fgMuted">
                  +{picked.length - 12}
                </span>
              )}
            </span>
            <span className="flex-1" />
            {copied && <span className="text-2xs text-olive">{copied}</span>}
            <button
              onClick={() => copy(markdownRef, '已复制 Markdown 引用')}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fgMuted hover:border-lineHi hover:text-fg"
            >
              复制 Markdown 引用
            </button>
            <button
              onClick={() => copy(jsonRef, '已复制 JSON 清单')}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fgMuted hover:border-lineHi hover:text-fg"
            >
              复制 JSON 清单
            </button>
            <button
              onClick={() => copy(styleNote(pickedAssets[0]), '已复制生图 prompt')}
              disabled={!pickedAssets.length}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fgMuted hover:border-lineHi hover:text-fg disabled:opacity-40"
            >
              复制生图 prompt
            </button>
            <button
              onClick={() => setPicked([])}
              className="rounded-md border border-line px-3 py-1.5 text-[12px] text-fgFaint hover:text-fg"
            >
              清空
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
