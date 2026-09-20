import Link from 'next/link';
import SeverityBadge from '@/components/SeverityBadge';
import { liveStats, meta, orderedCategories, rules, sourceIndex, sourceTypeLabel, countBySeverity } from '@/lib/rules';
import { cookbookStats } from '@/lib/cookbook';
import { dimensions as stackDimensions } from '@/lib/stack';
import { arch, lanes as archLanes } from '@/lib/arch';
import { CATEGORY_THEME, SEVERITY_THEME, SEVERITY_ORDER } from '@/lib/theme';

/** 装配台规模，页面上的数字直接来自数据文件，不手写。 */
const stackDimCount = stackDimensions.length;
const stackOptionCount = stackDimensions.reduce((n, d) => n + d.options.length, 0);
const archLaneCount = archLanes.length;
const archCapCount = Object.keys(arch.capNames).length;
const archPolicyCount = arch.policies.length;

const EXITS = [
  {
    glyph: '▦',
    title: '人查',
    href: '/rules',
    accent: '#4FB0C6',
    desc: '规则库。分类 + 搜索 + 反例正例对照，任何一条 3 次点击内可达。',
    cta: '打开规则库',
  },
  {
    glyph: '⛨',
    title: '拿代码验',
    href: '/check',
    accent: '#E5484D',
    desc: '校验台。粘贴代码，按规则逐条比对，输出带行号的违规清单与合规分。',
    cta: '去校验',
  },
  {
    glyph: '⎘',
    title: '给 AI 用',
    href: '/export',
    accent: '#D9A441',
    desc: '导出中心。一份规则编译成 System Prompt / .cursorrules / CLAUDE.md / MCP。',
    cta: '去导出',
  },
];

export default function HomePage() {
  const maxCat = Math.max(...orderedCategories.map((c) => c.rules.length), 1);
  const topSources = sourceIndex.slice(0, 8);
  const mustRules = rules.filter((r) => r.severity === 'MUST' || r.severity === 'NEVER');
  const undecided = rules.filter((r) => r.status !== 'active').length;

  return (
    <div className="animate-fade-up space-y-9">
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 100% at 0% 0%, rgba(217,164,65,0.10) 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, rgba(127,166,80,0.07) 0%, transparent 60%)',
          }}
        />
        <div className="relative px-6 py-8 md:px-9 md:py-10">
          <div className="mono mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs uppercase tracking-[0.22em] text-fgFaint">
            <span style={{ color: '#D9A441' }}>◈</span>
            <span>personal code arsenal</span>
            <span className="text-lineHi">/</span>
            <span>v{meta.version}</span>
            <span className="text-lineHi">/</span>
            <span>{meta.releasedAt}</span>
          </div>

          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg md:text-[34px]">
            杨先生的军火库
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fgMuted">
            我不用 AI 写的代码去反推规范 —— 那等于把自己的毛病立碑。这里的每一条都来自
            <span className="text-fg">行业基准</span>：
            阿里巴巴 Java 开发手册、Google Java Style、Spring 官方约定、OWASP、Effective Java。
            目的只有一个 ——{' '}
            <span className="text-brass">让任何 AI 生成的代码，都收敛到同一套规范上。</span>
          </p>

          {/* 关键数字 */}
          <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Metric label="规则总数" value={String(liveStats.total)} unit="条" sub="覆盖 9 大类" />
            <Metric
              label="强制级"
              value={String(liveStats.mustClass)}
              unit={`/${liveStats.mustHardLimit}`}
              sub={`配额已用 ${liveStats.budgetUsedPct}%`}
              accent={liveStats.budgetUsedPct >= 100 ? '#E5484D' : '#D9A441'}
            />
            <Metric
              label="可自动检出"
              value={String(liveStats.regexCapable)}
              unit="条"
              sub="正则层，零成本即时判定"
              accent="#56C596"
            />
            <Metric label="溯源出处" value={String(liveStats.sources)} unit="个" sub="无出处不收录" />
          </div>
        </div>
      </section>

      {/* ── 三种出口 ─────────────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="core design"
          title="一份数据，三种出口"
          desc="修改任何一条规则，下面三处同时生效。这是整个项目唯一不能妥协的架构决策。"
        />
        <div className="grid gap-3 md:grid-cols-3">
          {EXITS.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              className="panel panel-hover group flex flex-col p-5"
              style={{ borderColor: '#243029' }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded border text-base"
                  style={{
                    color: e.accent,
                    borderColor: e.accent + '40',
                    background: e.accent + '14',
                  }}
                >
                  {e.glyph}
                </span>
                <span className="text-[15px] font-semibold text-fg">{e.title}</span>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-fgMuted">{e.desc}</p>
              <span
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium transition-transform group-hover:translate-x-0.5"
                style={{ color: e.accent }}
              >
                {e.cta}
                <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-dashed border-line bg-surface/60 px-4 py-3">
          <p className="text-xs leading-relaxed text-fgFaint">
            <span className="mono text-fgMuted">source of truth</span> →{' '}
            <span className="mono text-brass">arsenal-rules/**/*.json</span>　规则是结构化对象，
            不是 Markdown 散文。前端、后端、导出器读的是同一份文件。
            你改 JSON，三条路一起变。
          </p>
        </div>
      </section>

      {/* ── 案例库与装配台 ───────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="beyond rules"
          title="除了「不能做什么」，还有「该怎么做」"
          desc="规则解决的是约束，但只给约束，AI 仍然不知道一个完整功能该长什么样。所以补上这两块内容资产。"
        />
        <div className="grid gap-3 md:grid-cols-2">
          {[
            {
              glyph: '▤',
              title: '最佳实践案例库',
              href: '/blueprints',
              accent: '#4FB0C6',
              desc:
                '一个功能「完整该怎么写」。每个案例是一条端到端垂直切片 ——' +
                'Controller、DTO、Service、Repository、建表脚本、单测一路写全，' +
                '每段代码旁边都有编号备注说明为什么这样写、对应哪条规则，' +
                '并写明什么时候不要用这套写法。',
              stats: [
                `${cookbookStats.features} 条案例`,
                `${cookbookStats.files} 个文件`,
                `${cookbookStats.lines} 行代码`,
                `${cookbookStats.highlights} 条要点`,
              ],
              cta: '打开案例库',
            },
            {
              glyph: '⬡',
              title: '架构装配台',
              href: '/stack',
              accent: '#D9A441',
              desc:
                '一个 Spring Boot 项目由哪些零件组成，以及它们能不能拼起来。' +
                '17 个模块摆成 6 层架构图，每块都声明它提供什么能力、需要什么能力 ——' +
                '拆掉任意一块必需模块，它直接告诉你跑不起来、缺的是哪一块。',
              stats: [
                `${stackDimCount} 个模块`,
                `${stackOptionCount} 个候选技术`,
                `${archLaneCount} 层泳道`,
                `${archCapCount} 项能力约束`,
              ],
              cta: '打开装配台',
            },
          ].map((e) => (
            <Link
              key={e.href}
              href={e.href}
              className="panel panel-hover group flex flex-col p-5"
              style={{ borderColor: '#243029' }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded border text-base"
                  style={{
                    color: e.accent,
                    borderColor: e.accent + '40',
                    background: e.accent + '14',
                  }}
                >
                  {e.glyph}
                </span>
                <span className="text-[15px] font-semibold text-fg">{e.title}</span>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-relaxed text-fgMuted">{e.desc}</p>
              <div className="mono mt-3 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fgFaint">
                {e.stats.map((s, i) => (
                  <span key={i}>{s}</span>
                ))}
              </div>
              <span
                className="mt-4 inline-flex items-center gap-1 text-xs font-medium transition-transform group-hover:translate-x-0.5"
                style={{ color: e.accent }}
              >
                {e.cta}
                <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 九大类分布 ───────────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="distribution"
          title="九大类分布"
          desc="强制级集中在哪里，一眼看清。点击进入对应分类。"
        />
        <div className="panel p-5">
          <div className="space-y-2.5">
            {orderedCategories.map(({ key, rules: list }) => {
              const t = CATEGORY_THEME[key];
              const c = countBySeverity(list);
              const widthPct = (list.length / maxCat) * 100;
              const segments = SEVERITY_ORDER.filter((s) => c[s] > 0).map((s) => ({
                s,
                n: c[s],
                pct: (c[s] / list.length) * 100,
              }));
              return (
                <div key={key} className="flex items-center gap-3">
                  <Link
                    href={`/rules#${key}`}
                    className="flex w-[92px] shrink-0 items-center gap-1.5 text-xs text-fgMuted transition-colors hover:text-fg"
                  >
                    <span style={{ color: t.color }}>{t.glyph}</span>
                    <span className="truncate">{t.name}</span>
                  </Link>
                  <div className="h-4 min-w-0 flex-1">
                    <div className="flex h-full" style={{ width: `${widthPct}%` }}>
                      {segments.map((seg) => (
                        <div
                          key={seg.s}
                          className="h-full first:rounded-l last:rounded-r"
                          style={{
                            width: `${seg.pct}%`,
                            background: SEVERITY_THEME[seg.s].color,
                            opacity: 0.85,
                          }}
                          title={`${SEVERITY_THEME[seg.s].label} ${seg.n} 条`}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="mono w-6 shrink-0 text-right text-xs text-fgMuted">
                    {list.length}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
            {SEVERITY_ORDER.map((s) => (
              <span key={s} className="flex items-center gap-2 text-2xs text-fgMuted">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: SEVERITY_THEME[s].color, opacity: 0.85 }}
                />
                {SEVERITY_THEME[s].label}
                <span className="mono text-fgFaint">{liveStats.sev[s]}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 来源矩阵 + 配额 ──────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <SectionTitle
            eyebrow="sources"
            title="每条规则都有出处"
            desc="无出处不收录。出处即权威背书，也是日后能安心降级/升级的前提。"
          />
          <div className="panel overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-2xs uppercase tracking-wider text-fgFaint">
                  <th className="px-4 py-2.5 font-medium">来源</th>
                  <th className="px-3 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 text-right font-medium">引用</th>
                </tr>
              </thead>
              <tbody>
                {topSources.map((s) => (
                  <tr key={s.ref} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 text-fg">{s.ref}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                        {sourceTypeLabel(s.type)}
                      </span>
                    </td>
                    <td className="mono px-4 py-2.5 text-right text-fgMuted">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <SectionTitle eyebrow="budget" title="强制级配额" desc="规范超出人能记住的量，就变成摆设。" />
          <div className="panel p-5">
            <div className="flex items-baseline gap-2">
              <span className="stat-num text-[34px] font-semibold leading-none text-brass">
                {liveStats.mustClass}
              </span>
              <span className="mono text-sm text-fgFaint">/ {liveStats.mustHardLimit}</span>
              <span className="ml-auto text-2xs text-fgMuted">
                已用 <span className="mono text-brass">{liveStats.budgetUsedPct}%</span>
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surfaceMax">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, liveStats.budgetUsedPct)}%`,
                  background: liveStats.budgetUsedPct >= 100 ? '#E5484D' : '#D9A441',
                }}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fgMuted">
              {liveStats.budgetUsedPct >= 100
                ? '配额已满。想新增强制条目，必须先降级一条旧条目 —— 强制约束必须保持稀缺。'
                : '配额尚有余量。'}
            </p>
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-xs">
              <Row label="强制（MUST）" value={liveStats.sev.MUST} color={SEVERITY_THEME.MUST.color} />
              <Row label="禁止（NEVER）" value={liveStats.sev.NEVER} color={SEVERITY_THEME.NEVER.color} />
              <Row label="建议（SHOULD）" value={liveStats.sev.SHOULD} color={SEVERITY_THEME.SHOULD.color} />
              <Row label="可选（MAY）" value={liveStats.sev.MAY} color={SEVERITY_THEME.MAY.color} />
            </dl>
            <div className="mt-4 rounded border border-line bg-surfaceHi px-3 py-2.5 text-2xs leading-relaxed text-fgFaint">
              语义判定层（LLM）覆盖 {liveStats.llmCapable} 条，AST 层 {liveStats.astCapable} 条。
              前端校验台只跑正则层 {liveStats.regexCapable} 条，其余如实标注为「需后端 / 语义判定」，不伪造结果。
            </div>
          </div>
        </div>
      </section>

      {/* ── 强制级速览 ───────────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="enforcement"
          title={`强制级速览 · ${mustRules.length} 条`}
          desc="违反即返工。这是最需要被 AI 读到的部分，也是最值得你先过目的部分。"
        />
        <div className="grid gap-2 md:grid-cols-2">
          {mustRules.map((r) => (
            <Link
              key={r.id}
              href={`/rules/${r.id}`}
              className="panel panel-hover flex items-start gap-3 px-4 py-3"
            >
              <SeverityBadge severity={r.severity} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-fg">{r.title}</span>
                <span className="mono mt-1 block text-2xs text-fgFaint">{r.id}</span>
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-2xs text-fgFaint">
          另有 {liveStats.should} 条建议级、{liveStats.may} 条可选级、{undecided} 条待定稿 —— 完整清单见{' '}
          <Link href="/rules" className="text-brass hover:underline">
            规则库
          </Link>
          。
        </p>
      </section>

      {/* ── 下一步 ───────────────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="next"
          title="当前进度"
          desc="规则集已落盘，后端与校验引擎正在补齐。"
        />
        <div className="grid gap-3 md:grid-cols-3">
          <ProgressCard
            state="done"
            title="规则基线 v0.1"
            items={[
              `${liveStats.total} 条规则，全部可溯源`,
              'Rule JSON Schema + 完整性校验',
              '人读版基线文档',
            ]}
          />
          <ProgressCard
            state="done"
            title="前端规则库"
            items={[
              '概览 / 规则库 / 详情 / 校验台 / 导出中心',
              '正则层校验引擎（可离线）',
              '5 种载体一键复制',
            ]}
          />
          <ProgressCard
            state="doing"
            title="后端 arsenal-server"
            items={[
              'Spring Boot 3.2.5 · 端口 3011',
              'AST 层校验（JavaParser）',
              'Level 2 语义校验（LLM，强制行号）',
            ]}
          />
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────── 小组件

function Metric({
  label,
  value,
  unit,
  sub,
  accent = '#E8F0EC',
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wider text-fgFaint">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="stat-num text-[26px] font-semibold leading-none" style={{ color: accent }}>
          {value}
        </span>
        {unit && <span className="mono text-xs text-fgFaint">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-2xs text-fgFaint">{sub}</div>}
    </div>
  );
}

function SectionTitle({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="mb-3">
      <div className="mono text-2xs uppercase tracking-[0.2em] text-fgFaint">{eyebrow}</div>
      <h2 className="mt-1 text-[17px] font-semibold text-fg">{title}</h2>
      {desc && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fgMuted">{desc}</p>}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-2 text-fgMuted">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        {label}
      </dt>
      <dd className="mono text-fg">{value}</dd>
    </div>
  );
}

function ProgressCard({
  state,
  title,
  items,
}: {
  state: 'done' | 'doing';
  title: string;
  items: string[];
}) {
  const done = state === 'done';
  const color = done ? '#56C596' : '#D9A441';
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2">
        <span className="mono text-xs" style={{ color }}>
          {done ? '✓' : '◐'}
        </span>
        <span className="text-[14px] font-semibold text-fg">{title}</span>
        <span
          className="ml-auto rounded border px-1.5 py-0.5 text-2xs"
          style={{ color, borderColor: color + '45', background: color + '12' }}
        >
          {done ? '已完成' : '进行中'}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex gap-2 text-xs leading-relaxed text-fgMuted">
            <span className="text-fgFaint">·</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
