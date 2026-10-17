'use client';

import { useMemo, useState } from 'react';
import type { AutopsyArtifacts } from '@/lib/autopsy-data';
import { classBadge, structureMarkdown, type CodeStructure, type StructureClass, type StructureDir } from '@/lib/code-structure';
import { downloadText } from '@/lib/zip';

/**
 * 项目结构面板 —— 「这个项目的代码是怎么摆的」的答案面（2026-10-17 结构面板棒3）。
 *
 * 与架构面板另两张卡同款分工：树 / 徽标 / 层级释义 / Markdown 全在纯函数层
 * （`code-structure.ts`，由 `buildAutopsy()` 一次算出），本组件只负责显示与下载，
 * **不重算任何判据**（10-04「判定逻辑两份实现」事故）。
 *
 * 诚实口径（写死在页面文案里，不是注释里）：
 *   ① 被 ScanGuard 跳过的目录（.git / node_modules / target 等）不在树里 ——
 *      树是「读过的文件」，不是磁盘全貌（`structure.notes` 末条，原样上屏）；
 *   ② 0 Java 类（纯前端项目）明说「未扫到 Java 类」，不画一棵没类的树让人以为没类；
 *   ③ 中间目录直接文件是 0 —— 节点上报子树总数 total，不报 0；
 *   ④ 每个目录最多列 150 个子项，超了明说「其余 N 个未显示」并指向 Markdown 全量。
 *
 * 可折叠树的 state 在本组件内 —— 切子页签会重挂载、折叠态重置，
 * 这是有意的（换项目/换页签看新树，不继承上一次的展开形状）。
 */

/** 角色 → 徽标色。全部沿解剖台既有内联色约定，不引新色板：
 *  brass = AutopsyLab 命中 chip；olive / 蓝 = ServicePanel 声明来源 chip；
 *  muted = AutopsyLab 未上画布 chip；紫 = arch-layered domain 带点缀色；
 *  amber = 全仓截断/告警色；red = 「需要你知道的缺口」（与跨带直连标红同语义）。 */
const ROLE_COLOR: Record<string, string> = {
  controller: '#D9A441',
  service: '#7FA650',
  repository: '#5A9FD4',
  config: '#93A39C',
  domain: '#9F7FC4',
  util: '#E5A33D',
};

/** 单个目录/节点超过这个子项数就截断显示 —— 万类仓库全展开会把 DOM 撑爆，
 *  截断本身也是结论：页面上说清楚「其余 N 个未显示」，全量看 Markdown 导出。 */
const MAX_CHILDREN = 150;

export default function StructurePanel({
  artifacts,
  safeName,
}: {
  artifacts: AutopsyArtifacts;
  safeName: string;
}) {
  const s: CodeStructure = artifacts.structure;
  const [open, setOpen] = useState(true);
  // 全部节点路径（默认展开集合的候选池 + 全展开/全收起的操作面）
  const allPaths = useMemo(() => deepPaths(s.tree), [s.tree]);
  // 默认展开前两层（根 + 两层目录）—— 再深默认收起：
  // 既让浅项目形状一眼可见，又避免万类仓库一上场全展开。
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(allPaths.filter((p) => depthOf(p) > 2))
  );

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const truncatedNote = s.notes.find((n) => n.startsWith('扫描被闸门截断')) ?? null;
  const otherNotes = s.notes.filter((n) => n !== truncatedNote);

  return (
    <div className="space-y-3">
      {/* ── 截断亮条：真实闸门数字（ScanGuard.java 实测值），亮条只说「这不是全貌」 ── */}
      {s.stats.truncated && (
        <div
          className="rounded border px-2.5 py-2"
          style={{ borderColor: 'rgba(229,163,61,0.45)', background: 'rgba(229,163,61,0.08)' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: '#E5A33D' }}>
            扫描被闸门截断（单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时）—— 结构可能不全
          </p>
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
            下面的目录与类数应视为<b>下限</b>，不是结论；要拿全量结果，请把仓库拆小或提高闸门后重扫。
          </p>
        </div>
      )}

      {/* ── 卡片头：计数全部现读，不写死；0 也照实报 ── */}
      <div className="panel px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            一、这个项目的代码是怎么摆的
          </p>
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={
                'rounded px-2 py-0.5 text-[10.5px] transition-colors ' +
                (open ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
              }
            >
              {open ? '收起' : '预览'}
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(new Set())}
              className="rounded px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:text-fg"
              title="展开全部目录 —— 万类仓库会一次渲染大量节点，卡顿属预期"
            >
              全展开
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(new Set(allPaths))}
              className="rounded px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:text-fg"
            >
              全收起
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(structureMarkdown(s), `${safeName}-structure.md`, 'text/markdown')
              }
              className="rounded border px-2 py-0.5 text-[10.5px] transition-colors"
              style={{ borderColor: 'rgba(217,164,65,0.45)', color: '#D9A441' }}
            >
              下载 Markdown
            </button>
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[15px] font-bold" style={{ color: '#D9A441' }}>
            {s.stats.dirs} 目录 / {s.stats.classes} 类
          </span>
          <span className="text-[11px] text-fgMuted">
            读过的文件 {s.stats.files} 个 · Java 类判不出角色的 {s.unclassified.length} 个（未分类桶，不塞层）
          </span>
        </div>
      </div>

      {/* ── 边界说明：ScanGuard 跳过的目录 / 0 Java 类 —— 0 和空也是结论 ── */}
      {otherNotes.length > 0 && (
        <ul className="rounded border border-line px-2.5 py-2 text-[10.5px] leading-[16px] text-fgMuted">
          {otherNotes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {/* ── 层级释义条：七行（五带 + util + 未分类），desc / packages 现读 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          二、层级释义（这一层是什么 · 有哪些包）
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {s.layers.map((r) => (
            <li key={r.id} className="text-[10.5px] leading-[16px]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="mono rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    background:
                      r.id === 'unclassified'
                        ? 'rgba(229,72,77,0.12)'
                        : r.id === 'util'
                          ? 'rgba(229,163,61,0.12)'
                          : 'rgba(217,164,65,0.12)',
                    color:
                      r.id === 'unclassified' ? '#E5484D' : r.id === 'util' ? '#E5A33D' : '#D9A441',
                  }}
                >
                  {r.name} · {r.count} 个类
                </span>
              </span>
              <span className="ml-1.5 text-fgMuted">{r.desc}</span>
              {r.packages.length > 0 ? (
                <span className="ml-1.5 text-fgFaint">
                  包：{r.packages.join('、')}
                </span>
              ) : (
                <span className="ml-1.5 text-fgFaint">包：无（这一类没有判到角色）</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* ── 树：HTML 可折叠（React state，不用 dangerouslySetInnerHTML） ── */}
      {open && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            三、目录树（目录带计数 · 类带角色徽标，徽标后缀是判定依据）
          </p>
          <div className="mt-1.5 overflow-x-auto">
            <DirNode
              node={s.tree}
              depth={0}
              rootName={artifacts.facts.root}
              collapsed={collapsed}
              onToggle={toggle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function depthOf(path: string): number {
  return path ? path.split('/').length : 0;
}

/** 全部节点路径（默认展开集合的候选池） */
function deepPaths(node: StructureDir): string[] {
  const out: string[] = [];
  const walk = (n: StructureDir) => {
    for (const c of n.children) {
      out.push(c.path);
      walk(c);
    }
  };
  walk(node);
  return out;
}

function DirNode({
  node,
  depth,
  rootName,
  collapsed,
  onToggle,
}: {
  node: StructureDir;
  depth: number;
  rootName: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const label = node.path ? node.path.split('/').pop() : rootName || '(仓库根)';
  const isOpen = !collapsed.has(node.path);
  const kids = node.children.slice(0, MAX_CHILDREN);
  const hiddenDirs = node.children.length - kids.length;
  const shownClasses = node.classes.slice(0, MAX_CHILDREN);
  const hiddenClasses = node.classes.length - shownClasses.length;

  return (
    <div>
      <div className="flex min-w-0 items-baseline gap-1 py-[1px]" style={{ paddingLeft: depth * 10 }}>
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="mono w-3 shrink-0 text-left text-[10px] text-fgFaint hover:text-fg"
            aria-label={isOpen ? `收起 ${label}` : `展开 ${label}`}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="mono w-3 shrink-0 text-[10px] text-fgFaint">·</span>
        )}
        <span className="mono shrink-0 text-[11px] text-fg">{label}/</span>
        <span className="text-[10px] text-fgMuted">
          {node.total === node.files
            ? `${node.files} 文件`
            : `${node.total} 文件（${node.files} 直接在此）`}
          {node.java > 0 && ` · ${node.java} 类`}
        </span>
      </div>
      {isOpen && (
        <>
          {shownClasses.map((c) => (
            <ClassRow key={`${c.file}:${c.line ?? 0}:${c.name ?? ''}`} c={c} depth={depth + 1} />
          ))}
          {hiddenClasses > 0 && (
            <p
              className="py-[1px] text-[10px] text-fgFaint"
              style={{ paddingLeft: (depth + 1) * 10 }}
              title="下载 Markdown 看全量"
            >
              … 其余 {hiddenClasses} 个类未显示（上限 {MAX_CHILDREN}/目录，全量见 Markdown 导出）
            </p>
          )}
          {kids.map((c) => (
            <DirNode
              key={c.path}
              node={c}
              depth={depth + 1}
              rootName={rootName}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          {hiddenDirs > 0 && (
            <p
              className="py-[1px] text-[10px] text-fgFaint"
              style={{ paddingLeft: (depth + 1) * 10 }}
              title="下载 Markdown 看全量"
            >
              … 其余 {hiddenDirs} 个目录未显示（上限 {MAX_CHILDREN}/目录，全量见 Markdown 导出）
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ClassRow({ c, depth }: { c: StructureClass; depth: number }) {
  const color = c.layer ? (ROLE_COLOR[c.layer] ?? '#93A39C') : '#E5484D';
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 py-[1px]" style={{ paddingLeft: depth * 10 }}>
      <span className="mono shrink-0 text-[10.5px] text-fgMuted">{c.name ?? '（无名类）'}</span>
      <span
        className="mono shrink-0 rounded px-1.5 py-0.5 text-[10px]"
        style={{ background: 'rgba(255,255,255,0.05)', color }}
        title={`判定依据：${classBadge(c)}`}
      >
        {classBadge(c)}
      </span>
      <span className="mono min-w-0 truncate text-[10px] text-fgFaint" title={c.file}>
        {c.file}
      </span>
    </div>
  );
}
