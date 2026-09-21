'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import CopyButton from '@/components/CopyButton';
import {
  arch,
  auditArchitecture,
  nodeArch,
  skeletonPicks,
  slotsOfLane,
  STATUS_META,
  lanes,
} from '@/lib/arch';
import type { ArchGap } from '@/lib/arch';
import {
  composeStack,
  dimensionById,
  dimensions,
  emptyPicks,
  presetPicks,
  presets,
  renderConfigClassesMarkdown,
  renderOps,
  renderPrompt,
  renderYaml,
  stackScale,
} from '@/lib/stack';
import {
  buildExportPlan,
  formatBytes,
  projectDoc,
  renderAppClass,
  renderTreeText,
  riskReportMarkdown,
} from '@/lib/project';
import { downloadZip } from '@/lib/zip';
import type { StackPicks } from '@/lib/content-types';
import GapCard from './GapCard';
import Inspector from './Inspector';
import ProjectTree from './ProjectTree';
import SlotBlock from './SlotBlock';
import ArchDiagram from './ArchDiagram';
import { TONE } from './palette';

/**
 * 技术架构装配台。
 *
 * 与「勾选清单 + 出文本」的区别在于：这里先要回答一个问题 —— 拼起来能跑吗。
 * 画布上每个方块声明它提供什么能力、需要什么能力；校验求一次能力并集，
 * 缺的零件会以红色虚线块的形式留在原位，并写清缺它的后果；
 * 参与组合隐患的方块会直接把隐患标题写在脸上，而不是只标一个「有隐患」。
 *
 * 产物区按「你拿到手要干什么」分组，而不是按文件类型堆在一起：
 *   构建 / 源码 / 结构 / 交付
 * 最后一组是这次新增的重点 —— 结构图与一键导出。
 */

type TabId =
  | 'build' | 'yaml' | 'env'
  | 'app' | 'config' | 'code'
  | 'tree' | 'arch' | 'tech'
  | 'risk' | 'ops' | 'prompt';

interface TabSpec {
  id: TabId;
  glyph: string;
  /** 动态标签（构建文件随选型变名字） */
  label: string;
  count?: number;
}

export default function StackComposer() {
  const [picks, setPicks] = useState<StackPicks>(() => presetPicks('standard'));
  const [presetId, setPresetId] = useState<string | null>('standard');
  const [activeDim, setActiveDim] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('build');
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [exported, setExported] = useState<{ name: string; bytes: number; files: number } | null>(
    null
  );

  const audit = useMemo(() => auditArchitecture(picks), [picks]);
  const composed = useMemo(() => composeStack(picks), [picks]);
  const scale = useMemo(() => stackScale(composed), [composed]);
  const plan = useMemo(() => buildExportPlan(picks, audit), [picks, audit]);

  const yamlText = useMemo(() => renderYaml(composed), [composed]);
  const promptText = useMemo(() => renderPrompt(composed), [composed]);
  const configMd = useMemo(() => renderConfigClassesMarkdown(composed), [composed]);
  const appCode = useMemo(() => renderAppClass(picks), [picks]);
  const treeText = useMemo(() => renderTreeText(picks), [picks]);
  const riskMd = useMemo(
    () => riskReportMarkdown(picks, audit, projectDoc.artifactId),
    [picks, audit]
  );
  const ops = useMemo(() => renderOps(composed), [composed]);

  /** 槽位 → 它参与的组合隐患标题。「有隐患」三个字没有用，得说清是什么。 */
  const hazardsByDim = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of [...audit.blockers, ...audit.risks, ...audit.notes]) {
      for (const n of g.nodes) {
        if (!map[n]) map[n] = [];
        if (!map[n].includes(g.title)) map[n].push(g.title);
      }
    }
    return map;
  }, [audit]);

  const meta = STATUS_META[audit.status];
  const tone = TONE[meta.tone === 'bad' ? 'bad' : meta.tone === 'warn' ? 'warn' : 'ok'];

  const hazardCount = audit.blockers.length + audit.risks.length + audit.notes.length;
  const buildLabel = picks.build === 'gradle' ? 'build.gradle' : 'pom.xml';

  const TAB_GROUPS: { group: string; tabs: TabSpec[] }[] = [
    {
      group: '构建与配置',
      tabs: [
        { id: 'build', glyph: '◇', label: buildLabel },
        { id: 'yaml', glyph: '▤', label: 'application.yml' },
        { id: 'env', glyph: '⊘', label: '.gitignore' },
      ],
    },
    {
      group: 'Java 源码',
      tabs: [
        { id: 'app', glyph: '⬡', label: 'Application.java' },
        { id: 'config', glyph: '⚒', label: '配置类', count: composed.configClasses.length },
        { id: 'code', glyph: '⇄', label: '联动代码', count: composed.samples.length },
      ],
    },
    {
      group: '项目结构',
      tabs: [{ id: 'tree', glyph: '▦', label: '目录与导出', count: plan.files.length }],
    },
    {
      group: '交付',
      tabs: [
        { id: 'arch', glyph: '⊞', label: '架构图' },
        { id: 'tech', glyph: '⬡', label: '技术架构图' },
        { id: 'risk', glyph: '⚠', label: '隐患体检单', count: hazardCount },
        { id: 'ops', glyph: '▥', label: '运维清单' },
        { id: 'prompt', glyph: '⎘', label: '给 AI 的约束' },
      ],
    },
  ];

  function applyPicks(next: StackPicks, preset: string | null) {
    setPicks(next);
    setPresetId(preset);
    setExported(null);
  }

  function pick(dimId: string, optId: string) {
    setPicks((p) => ({ ...p, [dimId]: optId }));
    setPresetId(null);
    setExported(null);
  }

  function clear(dimId: string) {
    setPicks((p) => ({ ...p, [dimId]: '' }));
    setPresetId(null);
    setActiveDim(dimId);
    setExported(null);
  }

  /**
   * 跳到架构图。
   *
   * 产物区在页面下方，页签条要滚过整块画布才看得到 —— 只把页签做出来是不够的，
   * 得有一个首屏就能看见的入口，否则功能等于不存在。
   */
  const productsRef = useRef<HTMLElement | null>(null);
  function focusArch() {
    setTab('arch');
    setShowArtifacts(true);
    // 等页签内容渲染完再滚，否则滚到的是旧高度
    requestAnimationFrame(() => {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleExport() {
    const name = `${projectDoc.artifactId}-${plan.kind}.zip`;
    const bytes = downloadZip(
      plan.files.map((f) => ({ path: f.path, content: f.content })),
      name
    );
    setExported({ name, bytes, files: plan.files.length });
  }

  const missingRequired = audit.stats.requiredTotal - audit.stats.requiredFilled;

  return (
    <div className="space-y-4">
      {/* ── 顶部：这套组合能不能跑 ─────────────────────────── */}
      <div
        className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5"
        style={{ borderColor: tone.border, background: tone.soft }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="mono flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[14px] leading-none"
            style={{ background: tone.soft, color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {audit.status === 'runnable' ? '✓' : audit.status === 'incomplete' ? '!' : '×'}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight" style={{ color: tone.color }}>
              {meta.label}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
              {audit.status === 'broken' ? (
                <>
                  缺 <span style={{ color: '#E5484D' }}>{missingRequired}</span> 个必需模块
                  {audit.blockers.length - missingRequired > 0 && (
                    <>
                      ，另有{' '}
                      <span style={{ color: '#E5484D' }}>
                        {audit.blockers.length - missingRequired}
                      </span>{' '}
                      处能力没人提供
                    </>
                  )}
                  —— 这样的组合启动就会失败。
                </>
              ) : (
                <>
                  {meta.summary}
                  {hazardCount > 0 && (
                    <>
                      　其中{' '}
                      <span style={{ color: '#D9A441' }}>{hazardCount}</span> 条隐患已写明触发条件与现象。
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">预设</span>
          {presets.map((p) => {
            const on = presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPicks(presetPicks(p.id), p.id)}
                title={p.summary}
                className="rounded-md border px-2 py-1 text-[11px] transition-colors"
                style={{
                  borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                  background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: on ? '#D9A441' : '#93A39C',
                }}
              >
                {p.name}
              </button>
            );
          })}
          <span className="mx-1 h-[16px] w-px bg-line" />
          <button
            type="button"
            onClick={() => applyPicks(skeletonPicks(), null)}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            title="只保留必选模块，其余全部留空 —— 从最小可运行骨架开始搭"
          >
            只留必选
          </button>
          <button
            type="button"
            onClick={() => applyPicks(emptyPicks(), null)}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            title="拆到一块不剩，从零开始拼"
          >
            清空重搭
          </button>
          <span className="mx-1 h-[16px] w-px bg-line" />
          <button
            type="button"
            onClick={focusArch}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: 'rgba(217,164,65,0.6)',
              background: 'rgba(217,164,65,0.12)',
              color: '#D9A441',
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
      </div>

      {/* ── 画布 + 装配面板 ───────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          {lanes.map((lane, laneIdx) => {
            const slotIds = slotsOfLane(lane.id);
            /** 参与请求链路的槽位顺序；其余槽位是旁路件（如迁移工具） */
            const pipelineOrder = arch.pipelines[lane.id] ?? [];
            const filledCount = slotIds.filter((id) => picks[id]).length;
            return (
              <Fragment key={lane.id}>
                {laneIdx > 0 && (
                  <div className="flex items-center gap-2 py-0.5 pl-[26px]">
                    <span className="mono text-[11px] leading-none text-fgFaint">↓</span>
                    <span className="text-[9px] uppercase tracking-wider text-fgFaint">
                      请求向下穿过
                    </span>
                  </div>
                )}
                <section className="panel overflow-hidden">
                  <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
                    <span className="mono text-[13px] leading-none text-brass">{lane.glyph}</span>
                    <h3 className="text-2xs font-semibold tracking-wide text-fg">{lane.name}</h3>
                    <span className="mono text-[10px] text-fgFaint">
                      {filledCount}/{slotIds.length}
                    </span>
                    {pipelineOrder.length > 0 && (
                      <span className="mono rounded-sm border border-line px-1 text-[9px] leading-[14px] text-fgFaint">
                        请求链路 {pipelineOrder.length} 环
                      </span>
                    )}
                    <p className="ml-auto hidden max-w-[52%] text-right text-[10px] leading-[15px] text-fgFaint lg:block">
                      {lane.desc}
                    </p>
                  </header>
                  <div className="flex flex-wrap items-stretch gap-x-1.5 gap-y-2 px-4 py-3.5">
                    {slotIds.map((dimId) => {
                      const pipedIdx = pipelineOrder.indexOf(dimId);
                      const inPipeline = pipedIdx >= 0;
                      return (
                        <span key={dimId} className="flex shrink-0 items-stretch">
                          {/* 箭头与方块绑在同一个 flex item 里 —— 否则窄屏换行时
                              箭头会被留在上一行末尾，指向一个不存在的东西 */}
                          {inPipeline && pipedIdx > 0 && (
                            <span className="mono flex items-center pr-1.5 text-[13px] leading-none text-fgFaint">
                              →
                            </span>
                          )}
                          {/* 旁路件：不在请求链路上，用一条竖线隔开 */}
                          {!inPipeline && pipelineOrder.length > 0 && (
                            <span
                              className="mx-1.5 w-px self-stretch bg-lineHi"
                              title="旁路件：不参与请求处理，在发布/构建期起作用"
                            />
                          )}
                          <SlotBlock
                            dimId={dimId}
                            state={audit.slotStates[dimId] ?? 'empty'}
                            option={picks[dimId] ? findOption(dimId, picks[dimId]) : undefined}
                            hazards={hazardsByDim[dimId]}
                            active={activeDim === dimId}
                            onClick={() => setActiveDim(dimId)}
                            onClear={() => clear(dimId)}
                          />
                        </span>
                      );
                    })}
                  </div>
                </section>
              </Fragment>
            );
          })}
        </div>

        <Inspector
          audit={audit}
          activeDim={activeDim}
          picks={picks}
          onPick={pick}
          onClear={clear}
          onClose={() => setActiveDim(null)}
          onFocusDim={(d) => setActiveDim(d)}
        />
      </div>

      {/* ── 产物 ──────────────────────────────────────────── */}
      <section ref={productsRef} className="panel scroll-mt-4 overflow-hidden">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
          <span className="mono text-[13px] leading-none text-brass">⎗</span>
          <h3 className="text-2xs font-semibold text-fg">这套组合的产物</h3>
          <span className="mono text-[10px] text-fgFaint">
            {scale.deps} 个依赖 · {scale.configClasses} 个配置类 · {plan.files.length} 个可导出文件 ·{' '}
            {formatBytes(plan.bytes)}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                borderColor: 'rgba(217,164,65,0.6)',
                background: 'rgba(217,164,65,0.12)',
                color: '#D9A441',
              }}
              title={`打包 ${plan.files.length} 个文件为 zip：构建文件、启动类、配置类、迁移脚本、README、隐患单、架构图与技术说明`}
            >
              <span className="mono text-[12px] leading-none">⇩</span>
              一键导出项目
            </button>
            <button
              type="button"
              onClick={() => setShowArtifacts((v) => !v)}
              className="mono text-[10px] text-fgFaint hover:text-fg"
            >
              {showArtifacts ? '收起' : '展开'}
            </button>
          </div>
        </header>

        {/* 导出反馈：告诉用户包里到底装了什么，以及下一步怎么跑 */}
        {exported && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5"
            style={{ background: 'rgba(127,166,80,0.07)' }}
          >
            <span className="mono text-[11px] leading-none" style={{ color: '#7FA650' }}>
              ✓
            </span>
            <p className="text-2xs text-fgMuted">
              已导出 <span className="mono text-fg">{exported.name}</span>
              <span className="mx-2 text-fgFaint">·</span>
              {exported.files} 个文件 · {formatBytes(exported.bytes)}
              {exported.bytes > 0 && (
                <>
                  <span className="mx-2 text-fgFaint">·</span>
                  解压后 {plan.kind === 'maven' ? 'mvn spring-boot:run' : './gradlew bootRun'} 即可启动
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setExported(null)}
              className="mono ml-auto text-[10px] text-fgFaint hover:text-fg"
            >
              知道了
            </button>
          </div>
        )}

        {audit.status === 'broken' && (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2"
            style={{ background: 'rgba(229,72,77,0.07)' }}
          >
            <span className="mono text-[11px] leading-none" style={{ color: '#E5484D' }}>
              !
            </span>
            <p className="text-[10px] leading-[15px] text-fgMuted">
              当前组合还缺必需模块，导出的骨架同样不完整 —— 先把红色的块补上再导。
            </p>
          </div>
        )}

        {showArtifacts && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
              {TAB_GROUPS.map((g, gi) => (
                <Fragment key={g.group}>
                  {gi > 0 && <span className="h-[16px] w-px bg-line" />}
                  <div className="flex items-center gap-1">
                    <span className="mono mr-0.5 text-[9px] uppercase tracking-wider text-fgFaint">
                      {g.group}
                    </span>
                    {g.tabs.map((t) => {
                      const on = tab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTab(t.id)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                          style={{
                            background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                            color: on ? '#D9A441' : '#93A39C',
                          }}
                        >
                          <span className="mono text-[11px] leading-none">{t.glyph}</span>
                          {t.label}
                          {t.count !== undefined && t.count > 0 && (
                            <span className="mono text-[9px] text-fgFaint">{t.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Fragment>
              ))}
            </div>

            <div className="p-4">
              {tab === 'build' && (
                <div className="space-y-3">
                  <Hint
                    text={
                      plan.kind === 'maven'
                        ? '依赖按模块分组并去重。业务依赖一律不写 version —— 版本交给 parent BOM 统一管理。只包含你实际装上的零件。'
                        : 'Gradle 的 scope 与 Maven 不是一一对应：注解处理器（Lombok、MapStruct）必须同时进 compileOnly 与 annotationProcessor，少写后者时编译能过、生成的 getter 却是红的。'
                    }
                  />
                  {plan.files
                    .filter((f) => f.group === '构建' && f.path !== '.gitignore')
                    .map((f) => (
                      <CodeBlock
                        key={f.path}
                        code={f.content}
                        lang={f.path.endsWith('.xml') ? 'xml' : 'text'}
                        label={f.path}
                      />
                    ))}
                </div>
              )}

              {tab === 'yaml' && (
                <div className="space-y-3">
                  <Hint text="每段都标注了它来自哪一块。键名可直接使用，不要自行发明配置键。导出的 zip 里还带 application-dev / application-prod 两份 profile。" />
                  <CodeBlock code={yamlText} lang="yaml" label="application.yml" />
                </div>
              )}

              {tab === 'env' && (
                <div className="space-y-3">
                  <Hint text="这一份看着不起眼，但它是防密钥泄漏的最后一道机械防线 —— 把 .env 与 application-local.yml 排除掉，靠的是版本控制而不是人的记性。" />
                  <CodeBlock code={projectDoc.files.gitignore} lang="text" label=".gitignore" />
                </div>
              )}

              {tab === 'app' && (
                <div className="space-y-4">
                  <Hint text="启动类只有两个职责：包扫描锚点、以及必须在此生效的扫描注解。所有 @EnableXxx 都放在各自的配置类里 —— 这就是下面那张「开关归属表」存在的意义：让你一眼看出为什么这个类这么空。" />
                  <CodeBlock code={appCode} lang="java" label="Application.java" />

                  <section className="panel overflow-hidden">
                    <header className="border-b border-line px-4 py-2.5">
                      <h4 className="text-2xs font-semibold text-fg">全局开关归属表</h4>
                      <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                        当前组合里每一个全局开关由谁负责。删掉哪个配置类，等于关掉对应的开关 ——
                        这是把开关分散出去换来的好处：归属关系是可验证的。
                      </p>
                    </header>
                    <ul className="divide-y divide-line">
                      {projectDoc.switchOwners
                        .filter((s) => {
                          if (!s.when) return true;
                          return Object.entries(s.when).every(([dim, opts]) =>
                            picks[dim] ? opts.includes(picks[dim]) : false
                          );
                        })
                        .map((s) => (
                          <li
                            key={`${s.switch}-${s.owner}`}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                          >
                            <code className="mono w-[210px] shrink-0 text-2xs text-brass">
                              {s.switch}
                            </code>
                            <code className="mono w-[180px] shrink-0 text-[10px] text-fgMuted">
                              {s.owner}
                            </code>
                            <span className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgMuted">
                              {s.why}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </section>
                </div>
              )}

              {tab === 'config' && (
                <div className="space-y-4">
                  <Hint text="当前组合下必须存在的 Java 配置类。漏掉的后果通常不是报错，而是某个功能静默失效（例如忘记注册分页插件）。" />
                  {composed.configClasses.length === 0 ? (
                    <Empty text="当前组合不需要额外的 Java 配置类 —— 自动配置已经覆盖。" />
                  ) : (
                    composed.configClasses.map((c, i) => (
                      <CodeBlock
                        key={i}
                        code={c.code}
                        lang="java"
                        label={`${c.className} — ${c.path}`}
                      />
                    ))
                  )}
                  {composed.configClasses.length > 1 && (
                    <div className="flex justify-end">
                      <CopyButton text={configMd} label="复制全部配置类（Markdown）" />
                    </div>
                  )}
                </div>
              )}

              {tab === 'code' && (
                <div className="space-y-4">
                  <Hint text="选型不是「装个依赖」就完事 —— 它会改变你怎么写代码。这里是持久层、鉴权、缓存等零件对业务代码的实际影响。" />
                  {composed.samples.length === 0 ? (
                    <Empty text="当前组合没有额外的联动代码示例。" />
                  ) : (
                    composed.samples.map((s, i) => (
                      <CodeBlock
                        key={i}
                        code={s.code}
                        lang={s.lang}
                        label={`${s.dimName} · ${s.optName} — ${s.title}`}
                      />
                    ))
                  )}
                </div>
              )}

              {tab === 'tree' && (
                <div className="space-y-4">
                  <ProjectTree picks={picks} plan={plan} />
                  <div className="flex flex-wrap justify-end gap-2">
                    <CopyButton text={treeText} label="复制目录树文本" />
                    <CopyButton text={riskMd} label="复制隐患体检单（Markdown）" />
                  </div>
                </div>
              )}

              {tab === 'arch' && <ArchDiagram picks={picks} audit={audit} />}

              {tab === 'risk' && (
                <div className="space-y-4">
                  <Hint text="隐患是「组合」的属性，不是单个选项的属性 —— 所以它只能在选定之后才算得出来。每条都给了触发条件与可核对的现象：如果现象对不上，说明这条不成立，不必照着改。" />

                  {hazardCount === 0 && audit.gaps.length === 0 ? (
                    <Empty text="当前组合没有隐患。零件齐全、能力闭环，也没有拼起来才出现的问题。" />
                  ) : (
                    <>
                      <RiskSection
                        title="跑不起来"
                        hint="启动就会失败"
                        tone="bad"
                        items={audit.blockers}
                        onFocus={(d) => setActiveDim(d)}
                      />
                      <RiskSection
                        title="缺件"
                        hint="能启动，但少能力"
                        tone="warn"
                        items={audit.gaps}
                        onFocus={(d) => setActiveDim(d)}
                      />
                      <RiskSection
                        title="组合隐患"
                        hint="单独看都对，拼起来出事"
                        tone="warn"
                        items={audit.risks}
                        onFocus={(d) => setActiveDim(d)}
                      />
                      <RiskSection
                        title="提示"
                        hint="知道就行"
                        tone="info"
                        items={audit.notes}
                        onFocus={(d) => setActiveDim(d)}
                      />

                      <div className="flex justify-end">
                        <CopyButton text={riskMd} label="复制完整体检单（Markdown）" />
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'ops' && (
                <div className="space-y-4">
                  {ops.length === 0 && composed.env.length === 0 ? (
                    <Empty text="当前组合没有额外的运维动作 —— 起一个数据库就能跑。" />
                  ) : (
                    <>
                      {ops.length > 0 && (
                        <section className="panel overflow-hidden">
                          <div className="border-b border-line px-4 py-3">
                            <h4 className="text-[13px] font-semibold text-fg">上线前要做的事</h4>
                          </div>
                          <ol className="divide-y divide-line">
                            {ops.map((o, i) => (
                              <li key={i} className="flex gap-3 px-4 py-2.5">
                                <span
                                  className="mono mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border text-[9px]"
                                  style={{ borderColor: 'rgba(217,164,65,0.4)', color: '#D9A441' }}
                                >
                                  {i + 1}
                                </span>
                                <span className="text-2xs leading-relaxed text-fgMuted">{o}</span>
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}

                      {composed.env.length > 0 && (
                        <section className="panel overflow-hidden">
                          <div className="border-b border-line px-4 py-3">
                            <h4 className="text-[13px] font-semibold text-fg">
                              需要配置的环境变量
                            </h4>
                            <p className="mt-1 text-2xs text-fgFaint">
                              密钥一律走环境变量，不要写进 application.yml。
                            </p>
                          </div>
                          <ul className="divide-y divide-line">
                            {composed.env.map((e, i) => (
                              <li
                                key={i}
                                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                              >
                                <code className="mono text-2xs" style={{ color: '#D9A441' }}>
                                  {e.key}
                                </code>
                                <span className="text-2xs text-fgMuted">{e.desc}</span>
                                <span className="mono ml-auto text-[10px] text-fgFaint">
                                  {e.dimName}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === 'prompt' && (
                <div className="space-y-3">
                  <Hint text="把这段贴给任何 AI，它就不会再给你换成别的技术栈 —— 这是「一份数据三种出口」里「给 AI 用」那条路。" />
                  <CodeBlock
                    code={promptText}
                    lang="text"
                    label="技术选型约束 · System Prompt 片段"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── 说明：这张图怎么读 ─────────────────────────────── */}
      <section className="panel px-4 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <h3 className="text-2xs font-semibold text-fg">这张图怎么读</h3>
          <p className="text-[10px] leading-[15px] text-fgMuted">
            每个方块声明它<strong className="font-medium text-fg">提供</strong>什么能力、需要什么能力。
            校验就是把所有已装配方块提供的能力取并集，看谁的需求没被满足 ——
            没被满足就是缺零件。
            <span className="text-fgFaint">
              　层内用 <span className="mono">→</span> 串起来的是请求真正流经的链路；
              竖线隔开的模块是旁路件，只在发布或构建期起作用，请求不会经过它。
            </span>
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { tone: 'ok', text: '已装配：能力供应正常' },
            { tone: 'bad', text: '红色虚线：必选未装，跑不起来' },
            { tone: 'warn', text: '黄色：参与组合隐患（方块上直接写出是哪条）' },
            { tone: 'idle', text: '灰色虚线：可选项留空，不是错误' },
          ].map((l) => (
            <span key={l.text} className="flex items-center gap-1.5 text-[10px] text-fgFaint">
              <span
                className="inline-block h-[9px] w-[9px] rounded-sm border"
                style={{
                  borderStyle: l.tone === 'ok' || l.tone === 'warn' ? 'solid' : 'dashed',
                  borderColor: TONE[l.tone as keyof typeof TONE].border,
                  background: TONE[l.tone as keyof typeof TONE].soft,
                }}
              />
              {l.text}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-fgFaint">
            {dimensions.length} 块零件 / {lanes.length} 条泳道 / {Object.keys(nodeArch).length}{' '}
            个槽位 / {arch.policies.length} 条组合策略
          </span>
        </div>
      </section>
    </div>
  );
}

function RiskSection({
  title,
  hint,
  tone,
  items,
  onFocus,
}: {
  title: string;
  hint: string;
  tone: 'bad' | 'warn' | 'info';
  items: ArchGap[];
  onFocus: (dim: string) => void;
}) {
  if (!items.length) return null;
  const color = tone === 'bad' ? TONE.bad.color : tone === 'warn' ? TONE.warn.color : TONE.info.color;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <span className="mono text-[10px] uppercase tracking-wider" style={{ color }}>
          {title}
        </span>
        <span className="mono text-[10px] text-fgFaint">{items.length}</span>
        <span className="ml-auto text-[10px] text-fgFaint">{hint}</span>
      </div>
      {items.map((g, i) => (
        <GapCard key={`${g.title}-${i}`} gap={g} tone={tone} onFocus={onFocus} />
      ))}
    </section>
  );
}

function findOption(dimId: string, optId: string) {
  return dimensionById.get(dimId)?.options.find((o) => o.id === optId);
}

function Hint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-line bg-surface px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
      {text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-2xs text-fgFaint">{text}</p>
    </div>
  );
}
