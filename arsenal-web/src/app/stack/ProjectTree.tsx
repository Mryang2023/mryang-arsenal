'use client';

import { useMemo } from 'react';
import type { ExportPlan } from '@/lib/project';
import { filterTree, formatBytes, projectDoc, type TreeNode } from '@/lib/project';
import type { StackPicks } from '@/lib/content-types';

/**
 * 项目结构图。
 *
 * 与「贴一段 tree 命令输出」的区别在于三件事：
 *   ① 它跟着选型变。选 MyBatis-Plus 才有 resources/mapper/，选 Gradle 就没有 pom.xml；
 *      父目录若被过滤空，父目录一起消失 —— 不留空壳。
 *   ② 每个节点都写着它的职责，目录写职责而不是文件清单；
 *      带徽章的节点会告诉你「它是哪个零件带来的」。
 *   ③ 虚线框标出「条件节点」：换掉对应选型，这一整块会消失。
 *
 * 一条硬约束：不显示空目录。画出 resources/mapper/ 却什么都没有，
 * 用户会照着建一个空目录，然后开始怀疑整张图。
 */

interface Row {
  node: TreeNode;
  /** 每一层祖先：true 表示这一层还需要画一条竖线（祖先不是最后一个子节点） */
  guides: boolean[];
  isLast: boolean;
}

function flatten(nodes: TreeNode[], guides: boolean[]): Row[] {
  const rows: Row[] = [];
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    rows.push({ node, guides, isLast });
    if (node.kind === 'dir' && node.children?.length) {
      rows.push(...flatten(node.children, [...guides, !isLast]));
    }
  });
  return rows;
}

/** 徽章配色。同一个徽章在任何位置都是同一个颜色 —— 靠哈希会撞色，所以显式声明。 */
const BADGE_TONE: Record<string, string> = {
  所有项目: '#5E6E67',
  可选: '#5E6E67',
  导出附带: '#5E6E67',
  Maven: '#6E8FA8',
  Gradle: '#6E8FA8',
  'MyBatis-Plus': '#5FA8A0',
  JPA: '#5FA8A0',
  Druid: '#5FA8A0',
  Flyway: '#8A7FD0',
  Liquibase: '#8A7FD0',
  无迁移工具: '#8A7FD0',
  Caffeine: '#D9A441',
  Redis: '#D9A441',
  鉴权: '#7FA650',
  'Spring Security': '#7FA650',
  'Sa-Token': '#7FA650',
  Prometheus: '#6E8FA8',
  SpringDoc: '#6E8FA8',
  'XXL-Job': '#D9A441',
  '@Scheduled': '#D9A441',
  Nacos: '#6E8FA8',
  测试: '#7FA650',
  Testcontainers: '#7FA650',
  定时任务: '#D9A441',
  外部依赖: '#6E8FA8',
  启动类: '#D9A441',
};

function badgeColor(badge: string): string {
  return BADGE_TONE[badge] ?? '#93A39C';
}

const FILE_GROUP_TONE: Record<string, string> = {
  构建: '#6E8FA8',
  源码: '#7FA650',
  配置: '#D9A441',
  数据: '#8A7FD0',
  测试: '#5FA8A0',
  文档: '#93A39C',
};

export default function ProjectTree({
  picks,
  plan,
}: {
  picks: StackPicks;
  plan: ExportPlan;
}) {
  const visible = useMemo(
    () => filterTree(projectDoc.tree.children ?? [], picks),
    [picks]
  );
  const rows = useMemo(() => flatten(visible, []), [visible]);

  const counts = useMemo(() => {
    let dirs = 0;
    let files = 0;
    let conditional = 0;
    for (const r of rows) {
      if (r.node.kind === 'dir') dirs += 1;
      else files += 1;
      if (r.node.when) conditional += 1;
    }
    return { dirs, files, conditional };
  }, [rows]);

  const totalBytes = plan.files.reduce((n, f) => n + f.content.length, 0);

  return (
    <div className="space-y-4">
      {/* ── 概览 ───────────────────────────────────────────── */}
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
        <p className="text-2xs text-fgMuted">
          <span className="mono text-fg">{projectDoc.artifactId}/</span>
          <span className="mx-2 text-fgFaint">·</span>
          {counts.dirs} 个目录 / {counts.files} 个文件
          <span className="mx-2 text-fgFaint">·</span>
          <span style={{ color: '#D9A441' }}>{counts.conditional}</span> 个节点是条件出现
        </p>
        <p className="ml-auto text-[10px] text-fgFaint">
          导出包 {plan.files.length} 个文件 · {formatBytes(totalBytes)}
        </p>
      </div>

      {/* ── 树 ─────────────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <header className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-2.5">
          <span className="mono text-[13px] leading-none text-brass">▤</span>
          <h4 className="text-2xs font-semibold text-fg">目录结构</h4>
          <p className="ml-auto text-[10px] text-fgFaint">
            <span className="mono" style={{ color: '#D9A441' }}>◇</span>{' '}
            = 条件节点：换掉对应选型，这一块连同里面的文件会整体消失
          </p>
        </header>

        <div className="overflow-x-auto px-4 py-3">
          <div className="min-w-[720px]">
            {/* 根节点 */}
            <div className="flex items-center gap-2 py-1">
              <span className="mono text-[12px] font-semibold text-brass">
                {projectDoc.tree.name}
              </span>
              <span className="text-[10px] text-fgFaint">{projectDoc.tree.desc}</span>
            </div>

            {rows.map((row, idx) => (
              <TreeRow key={`${row.node.name}-${idx}`} row={row} />
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5">
          {projectDoc.structureLegend.map((l) => (
            <span key={l.text} className="flex items-center gap-1.5 text-[10px] text-fgFaint">
              {l.tone === 'badge' ? (
                <span
                  className="mono rounded-sm px-1 text-[9px] leading-[14px]"
                  style={{ color: '#5FA8A0', background: 'rgba(95,168,160,0.12)' }}
                >
                  MyBatis-Plus
                </span>
              ) : (
                <span
                  className="mono shrink-0 text-[11px] leading-none"
                  style={{ color: l.tone === 'dir' ? '#E8F0EC' : '#93A39C' }}
                >
                  {l.tone === 'dir' ? '▸' : '·'}
                </span>
              )}
              {l.text}
            </span>
          ))}
        </footer>
      </div>

      {/* ── 导出包内容 ─────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <header className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-4 py-2.5">
          <span className="mono text-[13px] leading-none text-brass">⎗</span>
          <h4 className="text-2xs font-semibold text-fg">导出包里的文件</h4>
          <p className="text-[10px] text-fgFaint">
            结构图描述的是「目标形态」，这里是「这次真的会给你哪些文件」
          </p>
        </header>
        <ul className="divide-y divide-line">
          {plan.files.map((f) => (
            <li key={f.path} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
              <span
                className="mono shrink-0 rounded-sm px-1 text-[9px] leading-[15px]"
                style={{
                  color: FILE_GROUP_TONE[f.group] ?? '#93A39C',
                  background: `${FILE_GROUP_TONE[f.group] ?? '#93A39C'}1f`,
                }}
              >
                {f.group}
              </span>
              <code className="mono text-2xs text-fg">{f.path}</code>
              {f.from && <span className="text-[10px] text-fgFaint">← {f.from}</span>}
              <span className="mono ml-auto text-[10px] text-fgFaint">
                {f.content ? `${f.content.split('\n').length} 行` : '占位'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── 悬空引用 ───────────────────────────────────────── */}
      {plan.dangling.length > 0 && (
        <div className="panel overflow-hidden" style={{ borderColor: 'rgba(217,164,65,0.4)' }}>
          <header className="border-b border-line px-4 py-2.5">
            <h4 className="text-2xs font-semibold text-fg">
              上手前需要自己补的类
              <span className="mono ml-2 text-[10px] font-normal text-fgFaint">
                {plan.dangling.length} 个
              </span>
            </h4>
            <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
              导出包只含「结构与配置」，不含业务代码 —— 业务代码每个项目都不一样。
              下面这些类被包里的配置类引用了，但不在包里。先看一遍，比编译报错时一个个撞要快。
            </p>
          </header>
          <ul className="divide-y divide-line">
            {plan.dangling.map((d) => (
              <li key={d.fqn} className="px-4 py-2">
                <code className="mono text-2xs" style={{ color: '#D9A441' }}>
                  {d.fqn}
                </code>
                <p className="mt-0.5 text-[10px] leading-[15px] text-fgMuted">
                  被 {d.usedBy.join('、')} 引用 · 预期落位{' '}
                  <code className="mono text-fgFaint">{d.path}</code>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 结构原则 ───────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <header className="border-b border-line px-4 py-2.5">
          <h4 className="text-2xs font-semibold text-fg">为什么这样分包</h4>
          <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
            结构图只告诉你「长什么样」，这四条告诉你「为什么不能长成别的样子」。
          </p>
        </header>
        <ul className="divide-y divide-line">
          {projectDoc.structureNotes.map((n) => (
            <li key={n.title} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-2xs font-medium text-fg">{n.title}</p>
                {n.rule ? (
                  <a
                    href={`/rules/${n.rule}`}
                    className="mono rounded-sm border border-line px-1 text-[9px] leading-[15px] text-fgFaint transition-colors hover:border-lineHi hover:text-brass"
                  >
                    {n.rule}
                  </a>
                ) : (
                  <span
                    className="mono rounded-sm px-1 text-[9px] leading-[15px]"
                    style={{ color: '#D9A441', background: 'rgba(217,164,65,0.10)' }}
                    title="规则集里目前没有守着这条的规则 —— 是个缺口"
                  >
                    规则缺口
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] leading-[16px] text-fgMuted">{n.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TreeRow({ row }: { row: Row }) {
  const { node, guides, isLast } = row;
  const isDir = node.kind === 'dir';
  const depth = guides.length;

  return (
    <div className="group flex items-stretch">
      {/* 连接线：每个祖先层一根竖线，最后一层画「├─」或「└─」。
          线色用 lineHi 而不是 line —— 在近墨底色上 line 太淡，
          整棵树会退化成「一堆缩进的文字」，看不出层级。 */}
      <span className="flex shrink-0 self-stretch" aria-hidden>
        {guides.map((draw, i) => (
          <span key={i} className="relative w-[18px] self-stretch">
            {draw && <span className="absolute bottom-0 left-[8px] top-0 w-px bg-treeLine" />}
          </span>
        ))}
        <span className="relative w-[20px] self-stretch">
          <span className="absolute left-[8px] top-0 w-px bg-treeLine" style={{ height: '50%' }} />
          {!isLast && <span className="absolute bottom-0 left-[8px] top-1/2 w-px bg-treeLine" />}
          <span className="absolute left-[8px] top-1/2 h-px w-[9px] bg-treeLine" />
        </span>
      </span>

      {/* 内容 */}
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
        <span
          className="mono shrink-0 text-[11px] leading-none"
          style={{ color: isDir ? '#E8F0EC' : '#93A39C' }}
        >
          {isDir ? '▸' : '·'}
        </span>
        <span
          className="mono shrink-0 truncate text-[11px] leading-[16px]"
          style={{
            width: 218,
            color: isDir ? (depth <= 2 ? '#E8F0EC' : '#C8D6D0') : depth <= 3 ? '#C8D6D0' : '#93A39C',
            fontWeight: isDir && depth <= 1 ? 600 : 400,
          }}
          title={node.name}
        >
          {node.name}
        </span>
        {node.badge && (
          <span
            className="mono shrink-0 rounded-sm px-1 text-[9px] leading-[15px]"
            style={{
              color: badgeColor(node.badge),
              background: `${badgeColor(node.badge)}1f`,
            }}
          >
            {node.badge}
          </span>
        )}
        <span className="min-w-0 truncate text-[10px] leading-[16px] text-fgFaint" title={node.desc}>
          {node.desc}
        </span>
        {node.when && (
          <span
            className="mono shrink-0 text-[10px] leading-[15px]"
            style={{ color: '#D9A441' }}
            title="条件节点：换掉对应选型后这一块会消失"
          >
            ◇
          </span>
        )}
      </div>
    </div>
  );
}
