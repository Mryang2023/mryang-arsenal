'use client';

import { Fragment, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import CodeBlock from '@/components/CodeBlock';
import CopyButton from '@/components/CopyButton';
import { formatBytes, projectDoc } from '@/lib/project';
import DeliveryStep from './steps/DeliveryStep';
import ScaffoldDelivery from './steps/ScaffoldDelivery';
import DeployGuides from './DeployGuides';
import DraftHistory from './DraftHistory';
import ExportGate, { type GateScope } from './ExportGate';
import StackDeck, { Empty, Hint } from './StackDeck';
import ProductOutline from './ProductOutline';
import JourneyBar from './JourneyBar';
import StepRail from './StepRail';
import useStackChannel from './useStackChannel';
import { PAGE_OF_STEP, stepOfDim } from './wizard';
import { TONE, INK, toneAt } from './palette';

/**
 * ④ 交付中心 —— `/stack/delivery`。
 *
 * 承载 ⑩ 交付 + 导出动作，外加组合产物的九个文件页签。
 * 「我拿到什么」是自成一页的心智，以前它埋在十步向导的最后一步里。
 */
/**
 * 页签 id。**加了这里就必须在下面渲染区补一个 `tab === 'x'` 分支** ——
 * 只加 id 不加分支的后果是页签按钮在、点进去一片空白，而且没有任何东西会报错
 * （「技术架构图」就这么空了一段时间）。结构层断言守这条。
 *
 * S2-7（2026-09-24）：`tree` / `arch` / `risk` 三个页签已砍 —— 与交付预览
 * 的「目录树 / 架构图 / 隐患」功能重叠，两处各养一份渲染是双倍维护。
 * 只留文件类页签；想看那三样走 ⑥ 的交付预览。
 */
type TabId =
  | 'build' | 'yaml' | 'env'
  | 'app' | 'config' | 'code'
  | 'ops' | 'prompt' | 'deploy';

interface TabSpec {
  id: TabId;
  glyph: string;
  /** 动态标签（构建文件随选型变名字） */
  label: string;
  count?: number;
}

export default function StackDelivery() {
  const router = useRouter();
  const ch = useStackChannel('delivery');
  const {
    picks, meta, baseId, audit, composed, scale, plan, projectName,
    artifacts, demoMode, moduleResolution, scaffoldForms, allEnvValues,
    yamlText, promptText, configMd, appCode, ops,
    drafts, reloadDrafts, restoreDraft, doDeleteDraft,
    tab, setTab, showArtifacts, setShowArtifacts, exported, setExported,
    deliveryView, setDeliveryView, deckFocus, setDeckFocus, deckRef, productsRef,
    step, stepSummary, stepIssues, nameOk, setParam, handleExport, buildLabel,
  } = ch;

  // S2-7：产物区只留文件类页签。目录树 / 架构图 / 隐患单在 ⑦ 交付预览
  // 有完整得多的版本（九块实时预览 vs 一份静态渲染），两处各养一份
  // 渲染分支是双倍维护 + 「两边数据对不上」的隐患源。
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
      group: '交付',
      tabs: [
        { id: 'ops', glyph: '▥', label: '运维清单' },
        { id: 'prompt', glyph: '⎘', label: '给 AI 的约束' },
      ],
    },
    {
      group: '部署',
      tabs: [{ id: 'deploy', glyph: '⚙', label: '部署指引' }],
    },
  ];

  /** 点阵 / 差异 chip 直达：目标步骤不在本页就换页 */
  function focusDim(dimId: string) {
    const target = stepOfDim(dimId) ?? 'layers';
    ch.setStep(target);
    ch.setActiveDim(dimId);
    const home = PAGE_OF_STEP[target];
    if (home !== '/stack/delivery') router.push(home);
  }

  /**
   * 预检闸的两份包 —— 各自独立过闸，不合成一个结论。
   * violations 一律由 `export-lint.ts` 算好后带在 plan / artifacts 上，
   * 本页只负责把它们摆到第一屏，不重算、不改写、不吞掉。
   */
  // useMemo 兜住数组字面量：不 memo 的话每帧都是新数组，
  // ExportGate 里那份 useMemo 等于白写（依赖一变就重算）。
  const gateScopes = useMemo<GateScope[]>(
    () => [
      {
        id: 'products',
        label: '组合产物包（⑦ 一键导出）',
        files: plan.files.length,
        violations: plan.violations,
      },
      {
        id: 'scaffold',
        label: '双包脚手架（后端 / 前端 / 全家桶）',
        files: artifacts.all.files.length,
        violations: artifacts.violations,
      },
    ],
    [plan.files.length, plan.violations, artifacts.all.files.length, artifacts.violations]
  );

  function renderStep() {
    switch (step) {
      case 'delivery':
        return deliveryView === 'preview' ? (
          <div ref={deckRef} className="space-y-4">
            {/* ⑩ 右栏：左边回答「点哪个按钮」，右边回答「点下去拿走什么」。
                窄屏（< xl）退成上下堆叠，概览在双包面板之后。 */}
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0">
                <ScaffoldDelivery
                  artifacts={artifacts}
                  demoMode={demoMode}
                  modules={moduleResolution.selected}
                  forms={scaffoldForms}
                  values={allEnvValues}
                />
              </div>
              <div className="min-w-0 xl:sticky xl:top-3 xl:self-start">
                <ProductOutline files={plan.files} bytes={plan.bytes} />
              </div>
            </div>
            <DeliveryStep
              picks={picks}
              meta={meta}
              audit={audit}
              composed={composed}
              baseId={baseId}
              projectName={projectName}
              onParam={setParam}
              focusTab={deckFocus}
              onFocusConsumed={() => setDeckFocus(null)}
            />
          </div>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">架构装配台 · 交付中心</h1>
      <StackDeck ch={ch} focusDim={focusDim} />
      <JourneyBar current="delivery" picks={picks} />
      {/* 预检闸首屏：能不能交付是进这一页要看到的第一个答案，
          所以它在版面切换之上 —— 「交付预览 / 组合产物」两个版面都在。 */}
      <ExportGate scopes={gateScopes} />
      <StepRail
        page="delivery"
        step={step}
        onStep={ch.setStep}
        summary={stepSummary}
        issues={stepIssues}
        canAdvance={nameOk}
        blockedHint={nameOk ? undefined : '先给项目起个名字（小写字母 + 点分段）—— 它要写进 pom 的 artifactId、application.yml 与 K8s 应用名。'}
      />
      {step === 'delivery' && (
        <div className="panel flex flex-wrap items-center gap-1.5 px-3 py-2">
          <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
            交付版面
          </span>
          <button
            type="button"
            data-delivery-view="preview"
            aria-pressed={deliveryView === 'preview'}
            onClick={() => setDeliveryView('preview')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors"
            style={{
              background: deliveryView === 'preview' ? toneAt('warn', 0.12) : 'transparent',
              color: deliveryView === 'preview' ? TONE.warn.color : INK.muted,
              border: `1px solid ${deliveryView === 'preview' ? toneAt('warn', 0.6) : INK.line}`,
            }}
          >
            <span className="mono text-[11px] leading-none">⬡</span>
            交付预览
          </button>
          <button
            type="button"
            data-delivery-view="products"
            aria-pressed={deliveryView === 'products'}
            onClick={() => setDeliveryView('products')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors"
            style={{
              background: deliveryView === 'products' ? toneAt('warn', 0.12) : 'transparent',
              color: deliveryView === 'products' ? TONE.warn.color : INK.muted,
              border: `1px solid ${deliveryView === 'products' ? toneAt('warn', 0.6) : INK.line}`,
            }}
          >
            <span className="mono text-[11px] leading-none">⎗</span>
            组合产物
            <span className="mono text-[10px] text-fgFaint">{plan.files.length}</span>
          </button>
        </div>
      )}
      {renderStep()}
      {/* ── 产物（⑦ 交付「组合产物」版面）────────────────────── */}
      {step === 'delivery' && deliveryView === 'products' && (
        <section ref={productsRef} className="panel scroll-mt-4 overflow-hidden">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
            <span className="mono text-[13px] leading-none text-brass">⎗</span>
            <h3 className="text-2xs font-semibold text-fg">
              {projectName || projectDoc.artifactId} 这套组合的产物
            </h3>
            <span className="mono text-[10px] text-fgFaint">
              {scale.deps} 个依赖 · {scale.configClasses} 个配置类 · {plan.files.length} 个可导出文件 ·{' '}
              {formatBytes(plan.bytes)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                // 与首屏预检闸同一口径：这份包被拦，按钮就是灰的（点了也只会弹一份拒绝清单）
                disabled={plan.violations.length > 0}
                data-export-products=""
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  plan.violations.length > 0 ? 'cursor-not-allowed opacity-40' : ''
                }`}
                style={{
                  borderColor: toneAt('warn', 0.6),
                  background: toneAt('warn', 0.12),
                  color: TONE.warn.color,
                }}
                title={
                  plan.violations.length > 0
                    ? '预检闸未通过 —— 这份包打出来跑不起来，已禁止导出（见页面顶部清单）'
                    : `打包 ${plan.files.length} 个文件为 zip：构建文件、启动类、配置类、迁移脚本、README、隐患单、架构图与技术说明`
                }
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

          {/* 导出反馈：成功绿条告诉用户包里装了什么、怎么跑；被预检闸拦截时换红色清单 */}
          {exported?.blocked && (
            <div
              className="border-b border-rose-500/30 bg-rose-500/5 px-4 py-2.5"
              data-export-blocked=""
            >
              <p className="text-2xs font-semibold text-rose-400">
                导出被预检闸拦截 —— 这份包打出来也跑不起来，已拒绝打包
              </p>
              <ul className="mt-1 space-y-1">
                {exported.blocked.map((v, i) => (
                  <li key={`${v.check}-${i}`} className="text-2xs leading-relaxed text-fgMuted">
                    <span className="mono text-rose-400">[{v.check}]</span> {v.message}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setExported(null)}
                className="mono mt-1 text-[10px] text-fgFaint hover:text-fg"
              >
                知道了
              </button>
            </div>
          )}
          {exported && !exported.blocked && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5"
              style={{ background: toneAt('ok', 0.07) }}
            >
              <span className="mono text-[11px] leading-none" style={{ color: TONE.ok.color }}>
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
              style={{ background: toneAt('bad', 0.07) }}
            >
              <span className="mono text-[11px] leading-none" style={{ color: TONE.bad.color }}>
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
                      <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">
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
                              background: on ? toneAt('warn', 0.10) : 'transparent',
                              color: on ? TONE.warn.color : INK.muted,
                            }}
                          >
                            <span className="mono text-[11px] leading-none">{t.glyph}</span>
                            {t.label}
                            {t.count !== undefined && t.count > 0 && (
                              <span className="mono text-[10px] text-fgFaint">{t.count}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </Fragment>
                ))}

                {/* S2-7：目录树 / 架构图 / 隐患单三个页签已收编进交付预览
                    （那边是九块实时预览，比这里的一份静态渲染完整）。砍页签不砍入口。 */}
                <span className="h-[16px] w-px bg-line" />
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryView('preview');
                    setDeckFocus('arch');
                    requestAnimationFrame(() => {
                      deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-fgMuted transition-colors hover:text-fg"
                  title="目录树、架构图、隐患单在「交付预览」版面里 —— 图都是实时算出来的"
                >
                  <span className="mono text-[11px] leading-none">⬢</span>
                  目录树 / 架构图 / 隐患单 → 右侧交付预览
                </button>
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
                                    className="mono mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border text-[10px]"
                                    style={{ borderColor: toneAt('warn', 0.4), color: TONE.warn.color }}
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
                                  <code className="mono text-2xs" style={{ color: TONE.warn.color }}>
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

                {tab === 'deploy' && <DeployGuides picks={picks} meta={meta} />}

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
      )}

      {/* ── 方案历史（拍板项③）────────────────────────────────
          存过的草稿在这里取回 / 清理。放在版面之下：它回答「以前存过什么」，
          不该挡住「现在这套包能不能交付」—— 那是上面预检闸的活。 */}
      <DraftHistory
        drafts={drafts}
        onReload={reloadDrafts}
        onRestore={restoreDraft}
        onDelete={doDeleteDraft}
      />
    </div>
  );
}
