'use client';

import { useMemo, useState } from 'react';
import {
  affectedFeatures,
  buildFunctionView,
  MAX_CLUSTER_CLASSES,
  type FeatureCluster,
  type FunctionView,
} from '@/lib/call-closure';
import type { ProjectFacts } from '@/lib/facts-arch';

/**
 * 功能视图（第七页签）—— 「这个项目里都有哪些功能，剥掉一个要动多少」。
 *
 * <p>这一页**不做判定**：聚类算法在 `lib/call-closure.ts`（全仓唯一一份，纯函数）。
 * 本页只负责画，以及把三条 caveat 原样摆出来 ——
 * 尤其第一条：闭包只沿静态扫到的边走，反射与 SPI 是看不见的，
 * 所以「12 个类」是**下界**，不是剥离成本的保证。
 *
 * <p>本页最容易出的错是把「不可达」也画成一片空白：那些类可能是定时任务 / MQ 消费者，
 * 也可能是死代码 —— 所以它们单列成一节并说清「不知道是哪种」。
 */
export default function FunctionPanel({ facts }: { facts: ProjectFacts | null }) {
  const view = useMemo<FunctionView>(
    () => buildFunctionView(facts as never),
    [facts]
  );
  const [open, setOpen] = useState<string | null>(null);
  const [changed, setChanged] = useState('');

  const touched = useMemo(() => {
    const files = changed
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return affectedFeatures(view, files);
  }, [view, changed]);

  const noFacts = !facts;

  return (
    <div className="space-y-3">
      {/* ── 总账 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">功能视图</p>
        {noFacts ? (
          <p className="mt-2 text-[11px] leading-[17px] text-fgMuted">
            还没扫过这个项目 —— 先做一次「一键分析」，才有调用关系可聚类。
            <span className="mt-1 block text-[10px] text-fgFaint">
              没有 facts 时这一页显示为空，那是「没数据」，不是「这个项目没有功能」。
            </span>
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">
              {view.stats.seeds} 个种子（入口与路由处理类）沿调用边可达，聚出{' '}
              <span className="text-fg">{view.stats.clusters}</span> 条功能链；
              全图 {view.stats.classes} 个类 / {view.stats.edges} 条直接调用边。
            </p>
            {view.stats.clusters === 0 && (
              <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
                一条链都没聚出来 —— 最可能是这个项目的入口与路由处理类没被扫到，
                或它们的 id 与调用边上的类名对不上。<b>这不是「功能分得很干净」</b>，
                是一张空图，而空图与「没有功能」在界面上长得一模一样。
              </p>
            )}
            <ul className="mt-1.5 space-y-0.5">
              {view.caveats.map((c, i) => (
                <li key={`cv-${i}`} className="text-[10px] leading-[15px] text-fgFaint">
                  · {c}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── 功能链 ── */}
      {!noFacts && view.clusters.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            功能链（{view.clusters.length} 条 · 点开看「剥掉它要动哪些文件」）
          </p>
          <ul className="mt-2 space-y-1.5">
            {view.clusters.map((c) => (
              <ClusterRow
                key={c.id}
                c={c}
                highlighted={touched.some((t) => t.id === c.id)}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ── 「这次改动影响了哪些功能」—— C3 的同一份算法 ── */}
      {!noFacts && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            这次改动影响了哪些功能
          </p>
          <input
            value={changed}
            onChange={(e) => setChanged(e.target.value)}
            spellCheck={false}
            placeholder="粘贴改动的文件路径（空格或逗号分隔，相对仓库根）"
            className="mono mt-1.5 w-full rounded border border-line bg-transparent px-2 py-1 text-[10.5px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
          />
          {changed.trim() === '' ? (
            <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
              还没填文件。填几个路径就能看出这次改动落在哪几条功能链上 ——
              PR 机器人（CI 形态）用的就是这一段，不是另一份。
            </p>
          ) : touched.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
              这些文件不在任何一条功能链的闭包里。
              <b>这不等于「没影响」</b> —— 可能是静态扫不到那条边（反射 / SPI），
              也可能是文件路径没对上（大小写、前缀）。
            </p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {touched.map((c) => (
                <li key={`t-${c.id}`} className="text-[10.5px] leading-[16px] text-fgMuted">
                  · <span className="text-fg">{c.label}</span>
                  <span className="mono ml-1.5 text-fgFaint">
                    {c.classes.length} 类 / {c.files.length} 文件
                    {c.inbound.length > 0 && ` / 外部打进 ${c.inbound.length} 条`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── ③ 不可达：单列 ── */}
      {!noFacts && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            没被任何入口触到的类（{view.unreachable.classes.length}）
          </p>
          {view.unreachable.classes.length === 0 ? (
            <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">
              每个类都被至少一个入口触到了。这在真实项目里少见，别当成「分析很准」的好消息。
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
                这些类<b>不知道是哪种</b>：死代码，还是定时任务 / MQ 消费者这类另一个入口。
                所以单列在这里，不并进任何功能 —— 并进去会让闭包大小虚高，而那个数字正是决策依据。
              </p>
              <p className="mono mt-1 text-[10px] leading-[15px] text-fgMuted">
                {view.unreachable.classes.slice(0, 20).join('、')}
                {view.unreachable.classes.length > 20 && ` …还有 ${view.unreachable.classes.length - 20} 个`}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── 共享类：耦合点 ── */}
      {!noFacts && view.stats.sharedClasses.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            被多条功能链共享的类（{view.stats.sharedClasses.length} · 剥离任一功能前先看这里）
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {view.stats.sharedClasses.slice(0, 15).map((s) => (
              <li key={s.class} className="mono text-[10px] leading-[15px] text-fgMuted">
                {s.class}
                <span className="ml-1.5 text-fgFaint">{s.clusters} 条链都碰它</span>
              </li>
            ))}
          </ul>
          {view.stats.sharedClasses.length > 15 && (
            <p className="mt-1 text-[10px] text-fgFaint">
              …还有 {view.stats.sharedClasses.length - 15} 个没列出来
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterRow({
  c,
  open,
  highlighted,
  onToggle,
}: {
  c: FeatureCluster;
  open: boolean;
  highlighted: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={
        'rounded border px-2 py-1.5 ' +
        (highlighted ? 'border-lineHi bg-surfaceHi/40' : 'border-line')
      }
    >
      <button type="button" onClick={onToggle} className="flex w-full items-baseline gap-2 text-left">
        <span className="flex-1 text-[11px] text-fg">{c.label}</span>
        {highlighted && (
          <span className="mono text-[9.5px]" style={{ color: '#D9A441' }}>
            本次改动涉及
          </span>
        )}
        <span className="mono text-[9.5px] text-fgFaint">
          {c.classes.length} 类 / {c.files.length} 文件
        </span>
        <span className="mono text-[10px] text-fgMuted">{open ? '收起' : '展开'}</span>
      </button>
      <p className="mono mt-0.5 text-[10px] text-fgFaint">
        种子 {c.seed}（{c.seedKind === 'entrypoint' ? '可运行入口' : '路由处理类'}）
        {c.classes.length >= MAX_CLUSTER_CLASSES && '　⚠ 达到闭包上限，结果可能不完整'}
      </p>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {c.routes.length > 0 && (
            <div>
              <p className="mono text-[9.5px] uppercase text-fgFaint">带的路由</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.routes.map((r, i) => (
                  <li key={`r-${i}`} className="mono text-[10px] text-fgMuted">
                    {r.method} {r.path} → {r.handler}（{r.file}:{r.line}）
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mono text-[9.5px] uppercase text-fgFaint">
              剥掉它要动的文件（{c.files.length}）
            </p>
            <p className="mono mt-0.5 max-h-32 overflow-auto text-[10px] leading-[15px] text-fgMuted">
              {c.files.slice(0, 40).join('\n')}
              {c.files.length > 40 && `\n…还有 ${c.files.length - 40} 个`}
            </p>
          </div>
          {c.inbound.length > 0 && (
            <div>
              <p className="mono text-[9.5px] uppercase" style={{ color: '#E5A33D' }}>
                外部打进这条链（{c.inbound.length} · 切断它们才算真的剥掉）
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {c.inbound.slice(0, 10).map((e, i) => (
                  <li key={`i-${i}`} className="mono text-[10px] text-fgMuted">
                    {e.from} → {e.to}（{e.file}）
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] leading-[15px] text-fgFaint">
            闭包内 {c.internal} 条调用边，出到外部 {c.outbound} 条。闭包大小是<b>下界</b> ——
            反射 / SPI / 字符串拼类名扫不到。
          </p>
        </div>
      )}
    </li>
  );
}
