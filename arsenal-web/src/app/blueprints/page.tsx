import type { Metadata } from 'next';
import Link from 'next/link';
import { cookbookStats, cookbookMeta, features } from '@/lib/cookbook';
import { layerTheme } from '@/lib/theme';

export const metadata: Metadata = {
  title: '最佳实践案例库',
  description:
    '一案例一目录，独立可跑。每个案例回答「这个场景标准写法是什么」—— 端到端垂直切片，从 HTTP 入口到 SQL，并写清什么时候用、什么时候不要用、坑在哪。',
};

export default function BlueprintsPage() {
  return (
    <div className="animate-fade-up space-y-8">
      {/* ── Hero ─────────────────────────────────────── */}
      <header className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 100% at 0% 0%, rgba(79,176,198,0.10) 0%, transparent 58%), radial-gradient(80% 90% at 100% 100%, rgba(217,164,65,0.08) 0%, transparent 60%)',
          }}
        />
        <div className="relative px-6 py-7 md:px-9 md:py-9">
          <div className="mono mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs uppercase tracking-[0.2em] text-fgFaint">
            <span style={{ color: '#4FB0C6' }}>▤</span>
            <span>best practices</span>
            <span className="text-lineHi">/</span>
            <span>v{cookbookMeta.version}</span>
            <span className="text-lineHi">/</span>
            <span>{cookbookMeta.releasedAt}</span>
          </div>

          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg md:text-[32px]">
            最佳实践案例库
          </h1>
          <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-fgMuted">
            规则告诉你「什么不能做」，案例告诉你「完整该怎么做」。每个案例是一条
            <span className="text-fg">端到端的垂直切片</span>
            —— 从 Controller 到 SQL 一路写全，包括最容易漏掉的分支出口与并发冲突处理。
            每段代码旁边都有编号备注说明它为什么这样写、对应哪一条规则；每条案例还写清
            <span className="text-fg">什么时候不要用它</span>
            ，因为只讲优点的范例会被照抄到错误场景。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
            {[
              { k: '案例', v: cookbookStats.features, s: '条垂直切片' },
              { k: '代码文件', v: cookbookStats.files, s: '个完整文件' },
              { k: '代码行数', v: cookbookStats.lines, s: '行可直接抄' },
              { k: '要点备注', v: cookbookStats.highlights, s: '条为什么' },
            ].map((x) => (
              <div key={x.k} className="bg-surface px-4 py-3.5">
                <div className="text-2xs text-fgFaint">{x.k}</div>
                <div className="stat-num mt-1 text-[22px] font-semibold leading-none text-fg">
                  {x.v}
                </div>
                <div className="mt-1 text-2xs text-fgFaint">{x.s}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── 案例列表 ─────────────────────────────────── */}
      <section className="space-y-3">
        {features.map((f) => (
          <Link
            key={f.id}
            href={`/blueprints/${f.id}`}
            className="panel panel-hover group block overflow-hidden"
          >
            <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-lg"
                style={{
                  borderColor: 'rgba(79,176,198,0.32)',
                  background: 'rgba(79,176,198,0.07)',
                  color: '#4FB0C6',
                }}
              >
                {f.glyph}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16px] font-semibold text-fg transition-colors group-hover:text-brass">
                    {f.name}
                  </h2>
                  <span
                    className="rounded px-1.5 py-0.5 text-2xs"
                    style={{ background: 'rgba(217,164,65,0.13)', color: '#D9A441' }}
                  >
                    {f.level}
                  </span>
                  <span className="mono text-2xs text-fgFaint">{f.id}</span>
                </div>

                <p className="mt-1.5 text-[13px] leading-relaxed text-fgMuted">{f.subtitle}</p>

                {/* 数据流：把整条链路的层次先亮出来 */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {f.flow.map((s, i) => {
                    const lt = layerTheme(s.layer);
                    return (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-2xs text-lineHi">→</span>}
                        <span
                          className="rounded border px-1.5 py-0.5 text-2xs"
                          style={{
                            borderColor: lt.color + '33',
                            color: lt.color,
                            background: lt.color + '0F',
                          }}
                        >
                          {lt.glyph} {s.step}
                        </span>
                      </span>
                    );
                  })}
                </div>

                <div className="mono mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fgFaint">
                  <span>{f.fileCount} 个文件</span>
                  <span className="text-lineHi">|</span>
                  <span>{f.lines} 行代码</span>
                  <span className="text-lineHi">|</span>
                  <span>{f.highlightCount} 条要点</span>
                  <span className="text-lineHi">|</span>
                  <span>{f.ruleCount} 条关联规则</span>
                  <span className="text-lineHi">|</span>
                  <span>{f.notSuitable.length} 条不适用边界</span>
                </div>
              </div>

              <div className="shrink-0 self-center text-fgFaint transition-colors group-hover:text-brass">
                <span className="mono text-lg">→</span>
              </div>
            </div>
          </Link>
        ))}
      </section>

      {/* ── 使用说明 ─────────────────────────────────── */}
      <section className="panel p-5">
        <h3 className="text-[14px] font-semibold text-fg">怎么用这个案例库</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          {[
            {
              n: '①',
              t: '按场景查',
              d: '每个案例都写明「什么时候用」。先按场景找到对应那条，再决定抄不抄 —— 不要从头往下读。',
            },
            {
              n: '②',
              t: '当模板抄',
              d: '每个文件右上角都能一键复制。新起一个功能时先抄控制器与 Service，再照着改字段名。',
            },
            {
              n: '③',
              t: '当 AI 的参考',
              d: '让 AI 按案例写代码，比只说「按规范写」有效得多 —— 它需要的是可模仿的具体形状。',
            },
            {
              n: '④',
              t: '当自查清单',
              d: '每条案例末尾都有验收清单、常见坑与参考出处。提交前过一遍，能拦掉大部分低级问题。',
            },
          ].map((x) => (
            <div key={x.n} className="rounded-md border border-line bg-surfaceHi px-4 py-3">
              <div className="mono text-[13px]" style={{ color: '#D9A441' }}>
                {x.n}
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-fg">{x.t}</div>
              <p className="mt-1 text-2xs leading-relaxed text-fgMuted">{x.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
