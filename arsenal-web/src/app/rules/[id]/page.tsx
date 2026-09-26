import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import CodeBlock from '@/components/CodeBlock';
import CopyButton from '@/components/CopyButton';
import SeverityBadge from '@/components/SeverityBadge';
import { getRule, rules, rulesOfCategory, sourceTypeLabel } from '@/lib/rules';
import { recipesByRule } from '@/lib/cookbook';
import { CATEGORY_THEME, SEVERITY_THEME, CHECK_LAYER_THEME } from '@/lib/theme';

export function generateStaticParams() {
  return rules.map((r) => ({ id: r.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const r = getRule(params.id);
  if (!r) return { title: '未找到规则' };
  return {
    title: `${r.id} ${r.title}`,
    description: r.promptFragment,
  };
}

function langOf(rule: { check?: { regex?: { targetGlob?: string } } }): string {
  const g = rule.check?.regex?.targetGlob ?? '';
  if (g.includes('.sql')) return 'sql';
  if (g.includes('xml')) return 'xml';
  if (g.includes('yml') || g.includes('yaml') || g.includes('properties')) return 'yaml';
  if (g.includes('commit-msg')) return 'text';
  return 'java';
}

export default function RuleDetailPage({ params }: { params: { id: string } }) {
  const rule = getRule(params.id);
  if (!rule) notFound();

  const cat = CATEGORY_THEME[rule.category];
  const sev = SEVERITY_THEME[rule.severity];
  const layer = CHECK_LAYER_THEME[rule._checkLayer];
  const lang = langOf(rule);

  const siblings = rulesOfCategory(rule.category);
  const idx = siblings.findIndex((r) => r.id === rule.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // 反向索引：`recipesByRule` 在 cookbook.ts 里早已按规则 ID 建好，此前零引用。
  // 没有关联方案时**整块不渲染** —— 空壳区块会让「8/69 条规则有案例」这个真相看起来像 bug。
  const relatedRecipes = recipesByRule.get(rule.id) ?? [];

  const check = rule.check ?? {};

  // 给 AI 的完整片段：约束句 + 例子 —— 直接可粘贴
  const aiPayload = [
    `【${rule.id}】${rule.title}`,
    `级别：${sev.label}（${rule.severity}）`,
    '',
    `约束：${rule.promptFragment}`,
    '',
    `不要这样写：`,
    rule.bad,
    '',
    `应该这样写：`,
    rule.good,
  ].join('\n');

  return (
    <div className="animate-fade-up">
      {/* 面包屑 */}
      <nav className="mb-4 flex items-center gap-2 text-2xs text-fgFaint">
        <Link href="/rules" className="transition-colors hover:text-fgMuted">
          规则库
        </Link>
        <span>/</span>
        <Link
          href={`/rules#${rule.category}`}
          className="transition-colors hover:text-fgMuted"
          style={{ color: cat.color }}
        >
          {cat.name}
        </Link>
        <span>/</span>
        <span className="mono">{rule.id}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_248px]">
        {/* ── 主内容 ─────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <header>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={rule.severity} showCode />
              <span
                className="mono rounded border px-1.5 py-0.5 text-2xs"
                style={{ color: cat.color, borderColor: cat.color + '45', background: cat.color + '12' }}
              >
                {cat.glyph} {cat.name}
              </span>
              {rule.subcategory && (
                <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgFaint">
                  {rule.subcategory}
                </span>
              )}
            </div>

            <h1 className="mt-3 text-[21px] font-semibold leading-snug tracking-tight text-fg">
              {rule.title}
            </h1>
            <div className="mono mt-2 text-xs text-fgFaint">{rule.id}</div>
          </header>

          {/* 约束句 */}
          <section
            className="rounded-lg border p-4"
            style={{ borderColor: 'rgba(217,164,65,0.28)', background: 'rgba(217,164,65,0.055)' }}
          >
            {/* flex-wrap：390px 下「constraint · 给 AI 的原子约束」这一行加上两个按钮是 393px，
                不换行就多出 3px 横向滚动条（实测）。 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="mono text-2xs uppercase tracking-[0.18em]" style={{ color: '#D9A441' }}>
                constraint · 给 AI 的原子约束
              </span>
              <div className="flex gap-2">
                <CopyButton text={rule.promptFragment} label="复制约束句" compact />
                <CopyButton text={aiPayload} label="复制整条" compact />
              </div>
            </div>
            <p className="mt-2.5 text-[14px] leading-relaxed text-fg">{rule.promptFragment}</p>
          </section>

          {/* 为什么 */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-fgMuted">
              为什么要有这条
            </h2>
            <p className="text-[14px] leading-[1.75] text-fgMuted">{rule.rationale}</p>
          </section>

          {/* 反例 / 正例 */}
          <section>
            <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-fgMuted">
              写法对照
            </h2>
            <div className="grid gap-3">
              <CodeBlock code={rule.bad} lang={lang} tone="bad" label="反例 · 不要这样写" />
              <CodeBlock code={rule.good} lang={lang} tone="good" label="正例 · 应该这样写" />
            </div>
          </section>

          {/* 检查方式 */}
          <section>
            <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-fgMuted">
              怎么检查出来的
            </h2>
            <div className="panel divide-y divide-line">
              <CheckRow
                enabled={Boolean(check.regex)}
                layer="regex"
                title="正则层 · 文本匹配"
                note="零成本、可离线、确定性判定。前端校验台执行的就是这一层。"
              >
                {check.regex && (
                  <div className="mt-2.5 space-y-2">
                    <CodeBlock code={check.regex.pattern} lang="text" tone="neutral" label="pattern" showCopy={false} />
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fgFaint">
                      <span>
                        作用范围 <span className="mono text-fgMuted">{check.regex.targetGlob ?? '**/*'}</span>
                      </span>
                      <span>
                        判定 <span className="mono text-fgMuted">
                          {check.regex.expect === 'present' ? '必须命中（未命中即违规）' : '命中即违规'}
                        </span>
                      </span>
                      {check.regex.flags && (
                        <span>
                          flags <span className="mono text-fgMuted">{check.regex.flags}</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </CheckRow>

              <CheckRow
                enabled={Boolean(check.ast)}
                layer="ast"
                title="AST 层 · 语法树查询"
                note="需要 Java 解析器（JavaParser）。由后端 arsenal-server 执行，前端不做伪造判定。"
              >
                {check.ast && (
                  <div className="mt-2.5">
                    <CodeBlock
                      code={check.ast.query}
                      lang="text"
                      tone="neutral"
                      label={`query · engine=${check.ast.engine ?? 'javaparser'}`}
                      showCopy={false}
                    />
                  </div>
                )}
              </CheckRow>

              <CheckRow
                enabled={Boolean(check.llm)}
                layer="llm"
                title="语义层 · LLM 判定"
                note="仅用于 MUST / SHOULD。要求返回 是/否/不适用 + 行号定位；给不出行号的判定视为无效。"
              >
                {check.llm && (
                  <p className="mt-2.5 rounded border border-line bg-surfaceHi px-3 py-2.5 text-xs leading-relaxed text-fgMuted">
                    {check.llm}
                  </p>
                )}
              </CheckRow>

              <CheckRow
                enabled={Boolean(check.manual)}
                layer="manual"
                title="人工层 · 检查清单"
                note="无法自动判定，最后兜底。"
              >
                {check.manual && (
                  <p className="mt-2.5 rounded border border-line bg-surfaceHi px-3 py-2.5 text-xs leading-relaxed text-fgMuted">
                    {check.manual}
                  </p>
                )}
              </CheckRow>
            </div>
          </section>

          {/* 相关最佳实践 —— 这条规则在哪些真实案例里落地了 */}
          {relatedRecipes.length > 0 && (
            <section data-related-recipes={relatedRecipes.length}>
              <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-fgMuted">
                哪些案例在用这条规则
              </h2>
              <div className="space-y-2">
                {relatedRecipes.map(({ topic, scenario, recipe }) => (
                  <Link
                    key={`${topic.id}/${scenario.id}/${recipe.id}`}
                    href={`/blueprints/${topic.id}/${scenario.id}`}
                    className="panel panel-hover block px-4 py-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] text-fg">{recipe.name}</span>
                      <span className="mono text-2xs text-fgFaint">
                        {topic.glyph} {topic.name} / {scenario.name}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-fgMuted">{scenario.when}</p>
                    <p
                      className="mt-1.5 border-l-2 pl-3 text-xs leading-relaxed text-fgMuted"
                      style={{ borderColor: 'rgba(217,164,65,0.4)' }}
                    >
                      {recipe.approach}
                    </p>
                    <div className="mono mt-2 text-2xs text-fgFaint">
                      /blueprints/{topic.id}/{scenario.id} →
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 来源 */}
          <section>
            <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-fgMuted">
              出处
            </h2>
            <div className="space-y-2">
              {rule.sources.map((s, i) => (
                <div key={i} className="panel px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-fg">{s.ref}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgFaint">
                      {sourceTypeLabel(s.type)}
                    </span>
                  </div>
                  {s.quote && (
                    <blockquote
                      className="mt-2 border-l-2 pl-3 text-xs leading-relaxed text-fgMuted"
                      style={{ borderColor: cat.color + '55' }}
                    >
                      {s.quote}
                    </blockquote>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* 同分类导航 */}
          <nav className="flex gap-3 border-t border-line pt-4">
            {prev ? (
              <Link href={`/rules/${prev.id}`} className="panel panel-hover min-w-0 flex-1 px-3 py-2.5">
                <div className="text-2xs text-fgFaint">← 上一条</div>
                <div className="mt-0.5 truncate text-xs text-fgMuted">{prev.title}</div>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
            {next ? (
              <Link
                href={`/rules/${next.id}`}
                className="panel panel-hover min-w-0 flex-1 px-3 py-2.5 text-right"
              >
                <div className="text-2xs text-fgFaint">下一条 →</div>
                <div className="mt-0.5 truncate text-xs text-fgMuted">{next.title}</div>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
          </nav>
        </div>

        {/* ── 右栏元信息 ─────────────────────────────── */}
        <aside className="space-y-3 lg:sticky lg:top-9 lg:self-start">
          <div className="panel p-4">
            <h3 className="mono text-2xs uppercase tracking-[0.18em] text-fgFaint">检测能力</h3>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: layer.color }} />
              <span className="text-[13px]" style={{ color: layer.color }}>
                {layer.label}层
              </span>
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-fgFaint">{layer.desc}</p>
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              {(['regex', 'ast', 'llm', 'manual'] as const).map((k) => (
                <div key={k} className="flex items-center gap-2 text-2xs">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: check[k] ? CHECK_LAYER_THEME[k].color : '#243029' }}
                  />
                  <span style={{ color: check[k] ? '#93A39C' : '#4A5852' }}>
                    {CHECK_LAYER_THEME[k].label}
                    {check[k] ? '' : ' · 未定义'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel p-4">
            <h3 className="mono text-2xs uppercase tracking-[0.18em] text-fgFaint">规则元信息</h3>
            <dl className="mt-2.5 space-y-2 text-2xs">
              <Meta label="级别" value={`${sev.label} / ${rule.severity}`} color={sev.color} />
              <Meta label="分类" value={cat.name} color={cat.color} />
              <Meta label="版本" value={`v${rule.version}`} />
              <Meta label="状态" value={rule.status} />
              {rule.updatedAt && <Meta label="更新于" value={rule.updatedAt} />}
              {rule.appliesTo?.scope && <Meta label="作用域" value={rule.appliesTo.scope} />}
              {rule.supersedes && <Meta label="替代" value={rule.supersedes} />}
            </dl>
            {rule.appliesTo?.pathGlob && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="text-2xs text-fgFaint">适用路径</div>
                <div className="mono mt-1 break-all text-2xs text-fgMuted">{rule.appliesTo.pathGlob}</div>
              </div>
            )}
            {rule.appliesTo?.stack && rule.appliesTo.stack.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
                {rule.appliesTo.stack.map((s) => (
                  <span key={s} className="mono rounded bg-surfaceHi px-1.5 py-0.5 text-[10px] text-fgFaint">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {(rule.tags ?? []).length > 0 && (
            <div className="panel p-4">
              <h3 className="mono text-2xs uppercase tracking-[0.18em] text-fgFaint">标签</h3>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {rule.tags!.map((t) => (
                  <Link
                    key={t}
                    href="/rules"
                    className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                  >
                    {t}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="panel p-4">
            <h3 className="mono text-2xs uppercase tracking-[0.18em] text-fgFaint">数据溯源</h3>
            <div className="mono mt-2 break-all text-2xs text-fgMuted">
              arsenal-rules/{rule._sourceFile}
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-fgFaint">
              要改这条规则？改 JSON 文件即可 —— 规则库、导出器、校验引擎三处同时生效。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────── 子组件

function CheckRow({
  enabled,
  layer,
  title,
  note,
  children,
}: {
  enabled: boolean;
  layer: 'regex' | 'ast' | 'llm' | 'manual';
  title: string;
  note: string;
  children?: React.ReactNode;
}) {
  const t = CHECK_LAYER_THEME[layer];
  return (
    <div className="px-4 py-3.5" style={{ opacity: enabled ? 1 : 0.45 }}>
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-5 w-5 items-center justify-center rounded border text-[10px]"
          style={{
            color: enabled ? t.color : '#5E6E67',
            borderColor: enabled ? t.color + '50' : '#243029',
            background: enabled ? t.color + '14' : 'transparent',
          }}
        >
          {enabled ? '✓' : '—'}
        </span>
        <span className="text-[13px] font-medium text-fg">{title}</span>
        {!enabled && <span className="text-2xs text-fgFaint">本条规则未定义此层</span>}
      </div>
      <p className="mt-1.5 pl-[30px] text-2xs leading-relaxed text-fgFaint">{note}</p>
      {children && <div className="pl-[30px]">{children}</div>}
    </div>
  );
}

function Meta({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fgFaint">{label}</dt>
      <dd className="mono truncate" style={{ color: color ?? '#E8F0EC' }}>
        {value}
      </dd>
    </div>
  );
}
