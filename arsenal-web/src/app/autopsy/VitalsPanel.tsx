import { useMemo, useState } from 'react';
import {
  buildVitalsSeries,
  describeVitalsPoint,
  EMPTY_SERIES_MESSAGE,
  type VitalsSeriesPoint,
} from '@/lib/vitals-series';
import { diffPoints, downloadVitalsSeries } from '@/lib/vitals-store';

/**
 * 生命体征（第五页签）—— 「多看几次」的时间维度。
 *
 * 三条不许含糊的话（每条都在 UI 里出现，不许省）：
 *   ① **序列点来自两次来源**：本页每次体检落一枚（浏览器 localStorage，不清空就在），
 *      CLI `autopsy-watch once` 落的那份在磁盘 `.data/autopsy/<项目>/series.jsonl`，
 *      静态站读不到 —— 想两边合并得手工导入，这个能力今晚没做。
 *   ② **partial 的点不进曲线**，但留在列表里并写明为什么（后端没起来 / 被规模闸门截断）。
 *   ③ **曲线里的 N 个点必须等于列表里能用的点数** —— 「N」不许来自别的地方。
 */
export default function VitalsPanel({
  points,
  damaged,
  onClear,
}: {
  points: VitalsSeriesPoint[];
  damaged: { projectId: string; issues: string[] }[];
  onClear: () => void;
}) {
  const [openTs, setOpenTs] = useState<string | null>(null);

  const series = useMemo(() => buildVitalsSeries(points), [points]);
  const total = points.length;
  const usable = series.plotted;

  return (
    <div className="space-y-3">
      {/* ── 曲线 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、健康度曲线</p>
        {series.empty ? (
          <p className="mt-2 text-[11px] leading-[17px] text-fgMuted">
            {series.message}
            <span className="mt-1 block text-[10px] leading-[15px] text-fgFaint">
              序列点有两个来源：本页每次「一键体检」会落一枚（存在这台机器的浏览器里）；
              CLI 跑 <code className="mono">node scripts/autopsy-watch.mjs once --path &lt;dir&gt;</code>{' '}
              落的那份在磁盘上，静态站读不到。
            </span>
          </p>
        ) : (
          <>
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              共 {total} 枚序列点，其中 <span className="text-fg">{usable} 枚</span>采全了、进了曲线
              {series.skippedPartial > 0 && (
                <>
                  ；<span className="text-fg">{series.skippedPartial} 枚</span>是 partial（没采全），按规矩不进曲线
                </>
              )}
              。左轴是结论条数，右轴是覆盖率百分比
              {series.coverageTotal !== null && <>（分母 {series.coverageTotal} 条，来自数据不是写死的）</>}。
            </p>
            <div
              className="mt-2 overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: series.svg }}
            />
          </>
        )}
      </div>

      {/* ── 序列点列表 ── */}
      <div className="panel px-3 py-2.5">
        <div className="flex items-center justify-between">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            二、序列点{total > 0 ? `（${total} 枚）` : ''}
          </p>
          {total > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadVitalsSeries(points)}
                className="rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              >
                下载序列 JSONL
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              >
                清空本项目序列
              </button>
            </div>
          )}
        </div>

        {damaged.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {damaged.map((d, i) => (
              <li key={`${d.projectId}-${i}`} className="text-[10.5px] leading-[15px] text-fgFaint">
                [坏数据] {d.projectId}：{d.issues.join('；')}
              </li>
            ))}
          </ul>
        )}

        {total === 0 ? (
          <p className="mt-2 text-[11px] leading-[17px] text-fgMuted">
            {EMPTY_SERIES_MESSAGE}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {points.map((p, i) => {
              const prev = i > 0 ? points[i - 1] : null;
              const open = openTs === p.ts;
              // 差是**计数级**的（哪条规则修好了归 `diffSnapshots`，在历史页签）——
              // 两处都从 `vitals-point.mjs` 同一份实现来，页面不许自己减一遍。
              const d = prev
                ? diffPoints(
                    prev as unknown as Parameters<typeof diffPoints>[0],
                    p as unknown as Parameters<typeof diffPoints>[0]
                  )
                : null;
              return (
                <li key={`${p.ts}-${i}`} className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenTs(open ? null : p.ts)}
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <span className="mono text-[10.5px] text-fgFaint">{String(p.ts).slice(0, 16).replace('T', ' ')}</span>
                    <span className="flex-1 text-[10.5px] leading-[15px] text-fgMuted">
                      {describeVitalsPoint(p)}
                    </span>
                    <span className="mono text-[10px] text-fgFaint">{open ? '收起' : '变化详情'}</span>
                  </button>
                  {open && (
                    <div className="mt-1 rounded border border-line px-2 py-1.5">
                      <p className="mono text-[10px] text-fgFaint">
                        {String(p.fingerprint ?? '').slice(0, 12)}　{p.scan?.files ?? '?'} 文件 /{' '}
                        {p.scan?.ms ?? '?'}ms
                        {p.note ? `　备注：${p.note}` : ''}
                      </p>
                      {p.fingerprintCaveat && (
                        <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                          指纹口径：{p.fingerprintCaveat}
                        </p>
                      )}
                      {d ? (
                        <ul className="mt-1 space-y-0.5">
                          {[
                            `体检：P0 ${d.checkup.p0.prev ?? '未采到'} → ${d.checkup.p0.next ?? '未采到'}（${d.checkup.p0.delta === null ? '没采全，不比' : d.checkup.p0.delta === 0 ? '没变' : (d.checkup.p0.delta > 0 ? '+' : '') + d.checkup.p0.delta}）`,
                            `服务：${d.services.units.delta === null ? '单元未采到' : `单元 ${d.services.units.prev} → ${d.services.units.next}`}｜声明 ${d.services.declarations.prev ?? '未采到'} → ${d.services.declarations.next ?? '未采到'}`,
                            `覆盖率：${d.coverage.prev ?? '未采到'} → ${d.coverage.next ?? '未采到'}${d.coverage.total === null ? '' : ` / 共 ${d.coverage.total} 条`}`,
                            `文件数：${d.files.prev} → ${d.files.next}`,
                            `指纹：${d.sameFingerprint ? '与上一枚相同' : '与上一枚不同'}`,
                          ].map((line) => (
                            <li key={line} className="text-[10.5px] leading-[15px] text-fgMuted">
                              · {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[10.5px] leading-[15px] text-fgFaint">
                          这是第一枚点，没有上一次可以比。
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
