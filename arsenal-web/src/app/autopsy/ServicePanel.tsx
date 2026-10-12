'use client';

import type { AutopsyArtifacts } from '@/lib/autopsy-data';
import { downloadText } from '@/lib/zip';

/**
 * 服务拓扑面板 —— 「这个项目有几个服务」的答案面。
 *
 * 与架构面板同款分工：模型与图都在纯函数层（`service-topo.ts` / `service-graph.ts`，
 * 由 `buildAutopsy()` 一次算出），本组件只负责显示与下载，**不重算任何判据**。
 *
 * 页面顺序刻意对应「诚实五条」：各源数量分开报 → 人读结论 → 单元卡片（每条带出处）
 * → 调用图 → 冲突 → 未归属 → 读不到的目标 → 分桶。0 和 1 也走完这条链，
 * 不因为「没什么可显示」就整段消失 —— 0 本身是一条结论。
 */

/** 声明来源徽标三色 —— 与画布上 compose/k8s/code-entry 的视觉语言保持一致 */
const SOURCE_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  compose: { bg: 'rgba(217,164,65,0.14)', fg: '#D9A441', label: 'compose' },
  k8s: { bg: 'rgba(127,166,80,0.14)', fg: '#7FA650', label: 'k8s' },
  'code-entry': { bg: 'rgba(90,159,212,0.14)', fg: '#5A9FD4', label: '代码入口' },
};

const CONFLICT_LABEL: Record<string, string> = {
  'declared-no-code': '声明了，但没有代码能归属到它',
  'port-mismatch': '端口两处不一致',
  'replica-mismatch': '副本数两处不一致',
};

const RUNTIME_LABEL: Record<string, string> = {
  'spring-boot': '@SpringBootApplication',
  main: 'main()',
  'node-start': 'package.json start',
};

export default function ServicePanel({
  artifacts,
  safeName,
}: {
  artifacts: AutopsyArtifacts;
  safeName: string;
}) {
  const { topo, summary } = artifacts;
  const c = topo.counts;

  return (
    <div className="space-y-3">
      {/* ── 截断亮条：微服务仓库是最容易触顶的形状，触顶时报出来 ── */}
      {summary.truncated && (
        <div
          className="rounded border px-2.5 py-2"
          style={{ borderColor: 'rgba(229,163,61,0.45)', background: 'rgba(229,163,61,0.08)' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: '#E5A33D' }}>
            扫描被闸门截断（单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时）—— 服务清单可能不全
          </p>
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
            微服务仓库文件多、目录深，是最容易触顶的形状。下面的单元数应视为<b>下限</b>，
            不是结论；要拿全量结果，请把仓库拆小或提高闸门后重扫。
          </p>
        </div>
      )}

      {/* ── 一、总结行：各源数量分开报，合并后的数单独报 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          一、这个项目有几个服务
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[20px] font-bold" style={{ color: '#D9A441' }}>
            识别 {c.units} 个服务单元
          </span>
          <span className="text-[11px] text-fgMuted">
            来自 {artifacts.facts.services?.declarations?.length ?? 0} 条声明 —— 三源分开报，不猜一个数
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fgMuted">
          <span>
            compose 声明 <span className="mono text-fg">{c.compose}</span>
          </span>
          <span>
            k8s 工作负载 <span className="mono text-fg">{c.k8sWorkload}</span>
          </span>
          <span>
            代码可运行入口 <span className="mono text-fg">{c.codeEntry}</span>
          </span>
          <span>
            基础设施容器 <span className="mono text-fg">{c.infra}</span>（列出，不计入）
          </span>
          <span>
            非工作负载条目 <span className="mono text-fg">{c.nonWorkload}</span>（列出，不计入）
          </span>
          {c.unnamed > 0 && (
            <span style={{ color: '#E5A33D' }}>
              读不到名字的声明 <span className="mono">{c.unnamed}</span>（无法分组）
            </span>
          )}
        </div>
        {topo.notes.length > 0 && (
          <ul className="mt-2 space-y-1 rounded border border-line px-2.5 py-2 text-[10.5px] leading-[16px] text-fgMuted">
            {topo.notes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}
        {c.units === 0 && (
          <p className="mt-2 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
            0 个服务单元 —— 这本身是一条结论（检查过 compose 服务 / k8s 工作负载 / 代码可运行入口），
            不等于「没扫出来」；下面分桶列出了每条声明去了哪儿。
          </p>
        )}
      </div>

      {/* ── 二、服务单元卡片 ── */}
      {topo.units.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            二、服务单元（{topo.units.length} 个，按名排序）
          </p>
          <div className="mt-2 space-y-2">
            {topo.units.map((u) => {
              const out = topo.edges.filter((e) => e.from === u.name);
              const inn = topo.edges.filter((e) => e.to === u.name);
              const ing = topo.ingress.filter((i) => i.unit === u.name);
              return (
                <div key={u.name} className="rounded border border-line px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono break-words text-[12px] font-bold text-fg">{u.name}</span>
                    {u.codeOnly && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: 'rgba(90,159,212,0.14)', color: '#5A9FD4' }}
                      >
                        仅代码 · 部署清单无对应声明
                      </span>
                    )}
                    <span className="text-[10px] text-fgFaint">
                      {u.matchedOn === 'dir-name'
                        ? '入口按目录名挂载'
                        : u.matchedOn === 'name'
                          ? '入口按类名挂载'
                          : u.entries.length === 0
                            ? '没有可运行入口归属到它'
                            : '入口自成一个单元（部署清单无对应声明）'}
                    </span>
                  </div>

                  {/* 声明来源：每条带 path:line */}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.sources.map((s) => {
                      const chip = SOURCE_CHIP[s.source] ?? SOURCE_CHIP.compose;
                      return (
                        <span
                          key={`${s.source}-${s.path}-${s.line}`}
                          className="mono rounded px-1.5 py-0.5 text-[10px]"
                          style={{ background: chip.bg, color: chip.fg }}
                          title={`${s.source} 声明 · ${s.path}:${s.line}`}
                        >
                          {chip.label} {s.path}:{s.line}
                          {s.port != null && ` · 端口 ${s.port}`}
                          {s.replicas != null && ` × ${s.replicas}`}
                        </span>
                      );
                    })}
                  </div>

                  {/* 入口 */}
                  {u.entries.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-[16px] text-fgMuted">
                      {u.entries.map((e) => (
                        <li key={`${e.file}:${e.line}`} className="mono break-words">
                          <span className="text-fg">{e.className ?? '(未命名入口)'}</span>{' '}
                          <span style={{ color: '#5A9FD4' }}>
                            {RUNTIME_LABEL[e.runtime] ?? e.runtime}
                          </span>{' '}
                          ← {e.file}:{e.line}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* 路由 / 构建文件 */}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-fgMuted">
                    <span>
                      路由 <span className="mono text-fg">{u.routes.length}</span> 条
                      {u.routes.length > 0 && (
                        <span className="text-fgFaint">
                          （
                          {u.routes.slice(0, 3).map((rt) => `${rt.method} ${rt.path}`).join('、')}
                          {u.routes.length > 3 ? ` 等 ${u.routes.length} 条` : ''}）
                        </span>
                      )}
                    </span>
                    {u.dockerfiles.length > 0 && (
                      <span className="mono break-words">Dockerfile {u.dockerfiles.join('、')}</span>
                    )}
                    {u.poms.length > 0 && <span className="mono break-words">构建 {u.poms.join('、')}</span>}
                  </div>

                  {/* 调用 */}
                  {(out.length > 0 || inn.length > 0 || ing.length > 0) && (
                    <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-[16px] text-fgMuted">
                      {out.map((e) => (
                        <li key={`o-${e.to}-${e.kind}-${e.evidence}`} className="mono break-words">
                          <span style={{ color: '#7FA650' }}>→ 调用</span> {e.to}（{e.kind}）←{' '}
                          {e.evidence}
                        </li>
                      ))}
                      {inn.map((e) => (
                        <li key={`i-${e.from}-${e.kind}-${e.evidence}`} className="mono break-words">
                          <span style={{ color: '#5A9FD4' }}>← 被调用</span> {e.from}（{e.kind}）←{' '}
                          {e.evidence}
                        </li>
                      ))}
                      {ing.map((i) => (
                        <li key={`g-${i.upstream}`} className="mono break-words">
                          <span style={{ color: '#D9A441' }}>↗ nginx 转发</span> {i.upstream} ←{' '}
                          {i.evidence}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 三、服务调用图 ── */}
      {topo.units.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            三、服务调用图（{topo.counts.edges} 条边
            {topo.counts.externals > 0 ? ` · 外部目标 ${topo.counts.externals} 个（声明之外）` : ''} · 确定性网格布局）
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadText(artifacts.topoSvg, `${safeName}-services.svg`, 'image/svg+xml')
              }
              className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            >
              下载调用图 SVG
            </button>
            <span className="text-[10px] text-fgFaint">
              边上标注类型（feign / depends_on），每条边都能在卡片里找到 file:line 出处
              {topo.counts.externals > 0 ? '；点线 = 指向声明之外的目标' : ''}
            </span>
          </div>
          <div
            className="mt-2 overflow-auto rounded border border-line bg-surface"
            dangerouslySetInnerHTML={{ __html: artifacts.topoSvg }}
          />
        </div>
      )}

      {/* ── 四、冲突清单 ── */}
      {topo.conflicts.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            四、冲突清单（{topo.conflicts.length} 条，合并不了的并排说清）
          </p>
          <ul className="mt-2 space-y-2">
            {topo.conflicts.map((cf) => (
              <li
                key={`${cf.kind}-${cf.unit}`}
                className="rounded border px-2.5 py-2"
                style={{ borderColor: 'rgba(229,72,77,0.35)', background: 'rgba(229,72,77,0.06)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
                  <span className="mono">{cf.unit}</span> · {CONFLICT_LABEL[cf.kind] ?? cf.kind}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-[16px] text-fgMuted">{cf.detail}</p>
                <p className="mono mt-0.5 break-words text-[10px] text-fgFaint">
                  证据：{cf.evidence.join('、')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 五、未归属桶 ── */}
      {(topo.unattributed.routes.length > 0
        || topo.unattributed.dockerfiles.length > 0
        || topo.unattributed.poms.length > 0) && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            五、未归属桶（目录名与包路径都对不上，不强行归给最近的一个）
          </p>
          <div className="mt-2 space-y-1.5 text-[10.5px] leading-[16px] text-fgMuted">
            {topo.unattributed.routes.length > 0 && (
              <div>
                <p style={{ color: '#E5A33D' }}>
                  路由 {topo.unattributed.routes.length} 条无法归属：
                </p>
                <ul className="mono mt-0.5 space-y-0.5 break-words">
                  {topo.unattributed.routes.slice(0, 8).map((rt) => (
                    <li key={`${rt.file}-${rt.path}`}>
                      {rt.method} {rt.path} ← {rt.file}
                    </li>
                  ))}
                  {topo.unattributed.routes.length > 8 && (
                    <li className="text-fgFaint">…等 {topo.unattributed.routes.length} 条</li>
                  )}
                </ul>
              </div>
            )}
            {topo.unattributed.dockerfiles.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#E5A33D' }}>Dockerfile {topo.unattributed.dockerfiles.length} 个：</span>{' '}
                {topo.unattributed.dockerfiles.join('、')}
              </p>
            )}
            {topo.unattributed.poms.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#E5A33D' }}>构建文件 {topo.unattributed.poms.length} 个：</span>{' '}
                {topo.unattributed.poms.join('、')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── 六、外部目标与读不到的目标 ── */}
      {(topo.externals.length > 0 || topo.unresolvedTargets > 0 || topo.ingressUnmatched.length > 0) && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            六、调用目标：声明之外与读不到的
          </p>
          <div className="mt-2 space-y-1.5 text-[10.5px] leading-[16px] text-fgMuted">
            {topo.externals.length > 0 && (
              <ul className="mono space-y-0.5 break-words">
                {topo.externals.map((x) => (
                  <li key={`${x.from}-${x.target}-${x.kind}-${x.evidence}`}>
                    <span className="text-fg">{x.from} → {x.target}</span>（{x.kind}，匹配不上任何服务单元）←{' '}
                    {x.evidence}
                  </li>
                ))}
              </ul>
            )}
            {topo.unresolvedTargets > 0 && (
              <p>
                <span className="mono" style={{ color: '#E5A33D' }}>
                  {topo.unresolvedTargets} 个 HTTP 客户端读不到目标
                </span>{' '}
                —— RestTemplate / WebClient 的地址常在配置里，静态读不到：计数，不猜。
              </p>
            )}
            {topo.ingressUnmatched.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#E5A33D' }}>nginx 上游匹配不上：</span>{' '}
                {topo.ingressUnmatched.join('、')}（upstream 块名常见，列出不静默）
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── 七、分桶：基础设施 / 网络声明 / 未命名 ── */}
      {(topo.infra.length > 0 || topo.nonWorkload.length > 0 || topo.unnamed.length > 0) && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            七、分桶（分别报告，不计入服务数）
          </p>
          <div className="mt-2 space-y-1.5 text-[10.5px] leading-[16px] text-fgMuted">
            {topo.infra.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#93A39C' }}>基础设施容器：</span>{' '}
                {topo.infra.map((i) => `${i.name}（${i.image}，${i.evidence}）`).join('、')}
              </p>
            )}
            {topo.nonWorkload.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#93A39C' }}>非工作负载条目：</span>{' '}
                {topo.nonWorkload.map((n) => `${n.name ?? '(未读到名字)'} [${n.kind}] ${n.evidence}`).join('、')}
              </p>
            )}
            {topo.unnamed.length > 0 && (
              <p className="mono break-words">
                <span style={{ color: '#93A39C' }}>读不到名字的声明：</span>{' '}
                {topo.unnamed.map((d) => `${d.source} ${d.path}:${d.line}`).join('、')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
