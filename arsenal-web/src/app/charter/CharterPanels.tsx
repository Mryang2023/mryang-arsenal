'use client';

import { consistencyMode, l0DeclarationDrift, l0View, overrideView } from '@/lib/charter';
import {
  consistencyAvailable,
  consistencyConclusion,
  consistencyFor,
  consistencyKindLabel,
  consistencyScan,
  consistencyStatusClass,
  consistencyStatusLabel,
  consistencyVariantClass,
} from '@/lib/consistency';
import type { CharterDoc, OverduePolicy } from '@/lib/charter';

/**
 * 章程页的第四块内容：**对基线的偏离** + **一致性检查项**。
 *
 * 为什么单列一个组件而不并进三个页签：这两块的数据形态与条款/例外不同 ——
 * override 讲的是「**我们**和基线不一样在哪」，一致性讲的是「**全仓**的命名有没有在漂」。
 * 它们的读者也不同：前者给「刚进项目的人」，后者给「看到代码风格分裂的人」。
 * 挤进页签会让那三页签各有两种不相干的内容。
 */
export default function CharterPanels({ doc, today }: { doc: CharterDoc; today: string }) {
  return (
    <>
      <OverridePanel doc={doc} today={today} />
      <ConsistencyPanel doc={doc} />
      {l0DeclarationDrift && <L0DriftNote />}
    </>
  );
}

/* ── 对基线的偏离 ───────────────────────────────────────── */

function OverridePanel({ doc, today }: { doc: CharterDoc; today: string }) {
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h2 className="text-sm text-fg">对行业基线的偏离</h2>
      <p className="mt-1 text-xs text-fgMuted">
        基线（{doc.extends}）是跨项目复用的通用规矩，本项目只能<b>加严</b>、<b>放宽</b>（须有理由与到期日）或<b>替换</b>。
        这里没有「删除」这个动作 —— 删掉一条基线等于宣称所有人都不必遵守，与放宽不是一回事。
      </p>

      {doc.overrides.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-fgFaint">
          没有任何偏离 —— 本项目完全按基线执行。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {doc.overrides.map((ov) => {
            const v = overrideView(ov, today);
            return (
              <li
                key={`${ov.ruleId}-${ov.action}`}
                className="rounded-lg border border-line bg-surface px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-mono text-xs text-fgFaint">{ov.ruleId}</span>
                  <span className="text-xs text-fg">基线条款</span>
                  <span
                    className={[
                      'rounded px-1.5 py-0.5 text-[11px]',
                      v.tone === 'error' ? 'bg-rust/15 text-rust' : v.tone === 'warn' ? 'bg-brass/15 text-brass' : 'bg-olive/15 text-olive',
                    ].join(' ')}
                  >
                    {v.label}
                  </span>
                  {ov.pathGlob && <span className="font-mono text-[11px] text-fgFaint">{ov.pathGlob}</span>}
                </div>
                <p className="mt-1.5 text-xs text-fgMuted">{v.note}</p>
                {ov.reason && <p className="mt-1 text-xs text-fgFaint">理由：{ov.reason}</p>}
                {ov.action === 'relax' && (
                  <p className="mt-1 text-[11px] text-brass">
                    放宽是有时限的：到期后这条偏离自动失去依据，需要续期或收回。
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── 一致性检查项 ───────────────────────────────────────── */

function ConsistencyPanel({ doc }: { doc: CharterDoc }) {
  const hasScan = consistencyAvailable();
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">命名一致性</h2>
      <p className="mt-1 text-xs text-fgMuted">
        前四层检查（正则 / 语法树 / 语义 / 人工）全是<b>单文件</b>判定。这一项是<b>全仓聚合</b>的：
        同一个概念在不同文件里出现多种写法时，每个文件单独看都合规，合起来是一套漂移的代码。
      </p>

      {!hasScan && (
        <p className="mt-3 rounded-lg border border-brass/50 bg-brass/5 px-3 py-2 text-xs text-brass">
          还没有扫描结论 —— 跑一次 <code>npm run sync:consistency</code> 才会扫全仓。
          这里<b>不</b>把「没扫过」画成「一致」：没有数据来源时，零漂移和没检查长得一模一样。
        </p>
      )}

      {doc.consistency.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-fgFaint">
          未配置一致性检查项。这是合法起点 —— 但「每份文件都合规，合起来一套代码五种命名风格」
          正是多人协作最常见的退化方向，配一条比事后重构便宜。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {doc.consistency.map((c) => {
            const m = consistencyMode(c);
            const r = consistencyFor(c.id);
            return (
              <li key={c.id} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-mono text-xs text-fgFaint">{c.id}</span>
                  <span className="text-sm text-fg">{c.concept}</span>
                  {r ? (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${consistencyStatusClass(r.status)}`}>
                      {consistencyStatusLabel(r.status)}
                    </span>
                  ) : (
                    <span className="rounded bg-surfaceHi px-1.5 py-0.5 text-[11px] text-fgMuted">
                      {hasScan ? '本次扫描没覆盖到它' : '未扫描'}
                    </span>
                  )}
                  <span className={m.tone === 'error' ? 'text-xs text-rust' : 'text-xs text-brass'}>
                    {m.label}
                  </span>
                  <span className="font-mono text-[11px] text-fgFaint">{c.check.type}</span>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  {c.canonical.map((w) => (
                    <span key={`ok-${w}`} className="rounded bg-olive/15 px-1.5 py-0.5 text-olive">
                      {w}
                    </span>
                  ))}
                  {(c.forbidden ?? []).map((w) => (
                    <span key={`no-${w}`} className="rounded bg-rust/10 px-1.5 py-0.5 text-rust/80 line-through">
                      {w}
                    </span>
                  ))}
                </div>

                {r ? (
                  <>
                    <p className="mt-1.5 text-[11px] text-fgFaint">{consistencyConclusion(r)}</p>
                    {r.variants.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {r.variants.slice(0, 8).map((v) => (
                          <li key={v.variant} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                            <span className={`rounded px-1.5 py-0.5 ${consistencyVariantClass(v.kind)}`}>
                              {consistencyKindLabel(v.kind)}
                            </span>
                            <span className="font-mono text-fg">{v.variant}</span>
                            <span className="text-fgFaint">{v.count} 处 / {v.files} 个文件</span>
                            {v.samples[0] && (
                              <span className="font-mono text-fgFaint">
                                {shortPath(v.samples[0].file)}:{v.samples[0].line}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1.5 text-[11px] text-fgFaint">
                      范围 <span className="font-mono">{r.scope}</span>
                      {' · '}命中 {r.matchedFiles} 个文件
                      {r.report === 'block' ? ' · 配置为阻断' : ' · 只报不改'}
                    </p>
                  </>
                ) : (
                  <p className="mt-1.5 text-[11px] text-fgFaint">
                    范围 <span className="font-mono">{c.scope}</span>
                    {' · '}出现超过 {c.check.minVariants} 种写法就报
                    {c.check.report === 'drift' && '（只报不改 —— 漂移是团队级现象，不该由一个人扛）'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasScan && doc.consistency.length > 0 && (
        <p className="mt-3 text-[11px] text-fgFaint">
          扫描 {consistencyScan.scan.candidateFiles} 个文件 /
          {consistencyScan.scan.elapsedMs}ms · 生成于 {consistencyScan.generatedAt.slice(0, 10)}。
          引擎只认得配置里列出的写法及其近义变体 —— <b>没列过的全新同义词它发现不了</b>，
          「哪些词算同一个概念」仍然要人写进章程。
        </p>
      )}
    </section>
  );
}

/** 路径太长会挤掉右侧的列，只留末两段（前面的目录对定位没用）。 */
function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p;
}

/* ── L0 声明值漂移提示 ───────────────────────────────────── */

/**
 * L0 的 MUST「声明值」与「实测值」不一致时，在这里说出来。
 *
 * 为什么不静默用其中一个：本仓铁律是「手抄的数字必须由机器守住」，
 * 而这里的情况是**声明值已经过期**。页面若悄悄用实测值渲染，
 * 页面上看不出任何异常 —— 只有 meta-check 那一层会红，那是 CI 的事，
 * 看页面的人不会知道。所以页面上也留一条。
 */
function L0DriftNote() {
  return (
    <p className="mt-5 rounded-lg border border-brass/50 bg-brass/5 px-3 py-2 text-xs text-brass">
      基线的 MUST 声明值（{l0View.declared}）与实测值（{l0View.must}）不一致 ——
      共享配额口径下这会让预算显示失真。修 <code>arsenal-rules/meta.json</code> 的{' '}
      <code>budget.mustCurrent</code> 后重跑 <code>npm run sync:content</code>。
    </p>
  );
}
