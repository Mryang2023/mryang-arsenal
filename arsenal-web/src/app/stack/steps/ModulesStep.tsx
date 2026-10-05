'use client';

import { moduleById, moduleList, moduleStats } from '@/lib/scaffold/module-registry';
import type { ModuleDef, ModuleWarning } from '@/lib/scaffold/contracts';
import StepShell from './StepShell';
import type { StepSpec } from '../wizard';
import { TONE, INK, toneAt, gloss } from '../palette';

/**
 * ⑦ 功能模块：装配清单式选型（2026-10-05 换交互，取代「三张卡片点勾」）。
 *
 * 已装的模块排成一份**工程清单**：手动勾的做树根，依赖闭包带上的缩进挂在
 * 引入者下面、标「自动带上」—— 闭包不再是警告条里的一句解释，而是清单上
 * 看得见的结构。卸载按钮在「卸了也会被闭包原样带回来」时禁用并说明原因，
 * 不做点了没反应的假按钮；未装的模块进「待选件」托盘，点 ＋ 上架。
 * 勾选联动在父组件做（resolveModules 展开闭包）—— 这里只渲染结果；
 * 与选型冲突的组合仍以黄条列出并给修复建议。
 */
export default function ModulesStep({
  pickedIds,
  selectedIds,
  warnings,
  onToggle,
}: {
  /** 用户亲手勾的原始集合（未展开依赖）—— 区分「手动勾选」与「自动带上」全靠它 */
  pickedIds: string[];
  /** 依赖闭包解析后的最终选中集（含被自动带上的模块） */
  selectedIds: string[];
  warnings: ModuleWarning[];
  onToggle: (id: string) => void;
}) {
  const defs = moduleList();
  const byId = new Map<string, ModuleDef>(defs.map((d) => [d.id, d]));
  const pickedSet = new Set(pickedIds);
  const selectedSet = new Set(selectedIds);

  /** 传递依赖闭包：requires 展开到不动点（模块图无环、个位数节点，不必记访问栈） */
  const closureOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const walk = (cur: string) => {
      for (const dep of byId.get(cur)?.requires ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        out.push(dep);
        walk(dep);
      }
    };
    walk(id);
    return out;
  };

  /** 卸载后被闭包原样带回来的引入者名 —— 非空则 ✕ 必须禁用并说明，不做无效按钮 */
  const heldByPicked = (id: string): string | null => {
    for (const def of defs) {
      if (def.id === id || !pickedSet.has(def.id)) continue;
      if (closureOf(def.id).includes(id)) return def.name;
    }
    return null;
  };

  interface BomRow {
    def: ModuleDef;
    auto: boolean;
    /** auto 行的引入者名（谁把它带上的） */
    broughtBy?: string;
  }

  // 清单行：手动勾的做树根；闭包带上的缩进挂到第一个引入它的手动件下面
  const rows: BomRow[] = [];
  const shown = new Set<string>();
  for (const def of defs) {
    if (!pickedSet.has(def.id) || !selectedSet.has(def.id)) continue;
    rows.push({ def, auto: false });
    shown.add(def.id);
    for (const depId of closureOf(def.id)) {
      if (shown.has(depId) || !selectedSet.has(depId)) continue;
      const dep = byId.get(depId);
      if (dep) {
        rows.push({ def: dep, auto: true, broughtBy: def.name });
        shown.add(depId);
      }
    }
  }
  // 兜底：闭包万一漏挂，宁可平铺也不许已选模块凭空消失
  for (const def of defs) {
    if (selectedSet.has(def.id) && !shown.has(def.id)) {
      rows.push({ def, auto: !pickedSet.has(def.id) });
      shown.add(def.id);
    }
  }

  const totals = [...selectedSet].reduce(
    (acc, id) => {
      const def = byId.get(id);
      if (!def) return acc;
      const s = moduleStats(def);
      acc.endpoints += s.endpoints;
      acc.tables += s.tables;
      acc.menus += s.menus;
      acc.files += s.files;
      return acc;
    },
    { endpoints: 0, tables: 0, menus: 0, files: 0 },
  );

  const tray = defs.filter((d) => !selectedSet.has(d.id));

  return (
    <StepShell spec={STEP_SPEC}>
      {/* 工程清单：已装模块一棵树，手动勾的做根，依赖缩进挂着 */}
      <div className="px-4 pt-3" data-module-list="">
        <div className="flex items-baseline justify-between gap-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            工程清单 · 已装 {rows.length} 件
          </p>
          {rows.length > 0 && (
            <p className="mono text-[10px] text-fgFaint">勾选变动实时累计</p>
          )}
        </div>
        {rows.length === 0 ? (
          <p
            className="mt-2 rounded-lg border border-dashed px-3 py-4 text-2xs leading-relaxed text-fgMuted"
            style={{ borderColor: INK.dim }}
          >
            清单是空的 —— 什么都不装也能走（裸后端起家）；想装就从下面「待选件」里点 ＋。
          </p>
        ) : (
          <div
            className="mt-2 divide-y divide-line overflow-hidden rounded-lg border"
            style={{ borderColor: INK.line, background: gloss(0.02) }}
          >
            {rows.map((row) => {
              const stats = moduleStats(row.def);
              const held = row.auto ? null : heldByPicked(row.def.id);
              const menuPaths = row.def.menus.map((m) => m.path).join(' ');
              return (
                <div
                  key={row.def.id}
                  data-module={row.def.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pr-3"
                  style={{
                    paddingLeft: row.auto ? 36 : 12,
                    background: row.auto ? toneAt('warn', 0.04) : undefined,
                  }}
                >
                  <span
                    className="mono text-[13px] leading-none"
                    style={{ color: row.auto ? INK.faint : toneAt('warn') }}
                    aria-hidden
                  >
                    {row.auto ? '└⇢' : '⛁'}
                  </span>
                  <span
                    className={`text-[13px] font-semibold leading-tight ${row.auto ? 'text-fgMuted' : 'text-fg'}`}
                  >
                    {row.def.name}
                  </span>
                  {row.auto && row.broughtBy && (
                    <span
                      className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                      style={{ color: toneAt('warn'), background: toneAt('warn', 0.1) }}
                    >
                      由 {row.broughtBy} 自动带上
                    </span>
                  )}
                  <span className="mono text-[10px] leading-relaxed text-fgFaint">
                    {stats.endpoints} 接口 · {stats.tables} 表 · {stats.menus} 菜单页
                    {menuPaths ? ` · ${menuPaths}` : ''}
                  </span>
                  <span className="ml-auto">
                    {row.auto ? (
                      <span className="mono text-[10px] text-fgFaint">随引入者一起卸载</span>
                    ) : held ? (
                      <span
                        className="mono text-[10px] text-fgFaint"
                        title={`${held} 依赖它 —— 先卸 ${held} 才能卸这件`}
                      >
                        被 {held} 依赖 · 先卸它才能卸这件
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-module-remove={row.def.id}
                        onClick={() => onToggle(row.def.id)}
                        className="mono rounded-sm border px-1.5 py-0.5 text-[10px] text-fgMuted transition-colors hover:text-fg"
                        style={{ borderColor: INK.dim }}
                      >
                        ✕ 卸载
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <div
              className="mono flex flex-wrap items-center gap-x-3 px-3 py-2 text-[10px]"
              style={{ background: gloss(0.03), color: INK.pale }}
            >
              <span className="text-fgFaint">合计</span>
              <span>{totals.endpoints} 接口</span>
              <span>{totals.tables} 表</span>
              <span>{totals.menus} 菜单页</span>
              <span>{totals.files} 文件</span>
            </div>
          </div>
        )}
      </div>

      {/* 待选件托盘：没装的模块在这里，点 ＋ 上清单 */}
      {tray.length > 0 && (
        <div className="mt-3 border-t border-line px-4 py-3" data-module-tray="">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            待选件 · 点 ＋ 装上清单
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tray.map((def) => {
              const stats = moduleStats(def);
              return (
                <button
                  key={def.id}
                  type="button"
                  data-module={def.id}
                  onClick={() => onToggle(def.id)}
                  title={def.description}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors"
                  style={{ borderColor: INK.line }}
                >
                  <span className="mono text-[12px] leading-none" style={{ color: TONE.ok.color }}>
                    ＋
                  </span>
                  <span className="text-[12px] font-semibold text-fg">{def.name}</span>
                  <span className="mono text-[10px] text-fgFaint">
                    {stats.endpoints} 接口 · {stats.tables} 表
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5 border-t border-line px-4 py-3" data-module-warnings="">
          {warnings.map((w, i) => (
            <p
              key={i}
              className="rounded-md border px-3 py-2 text-2xs leading-relaxed"
              style={{ borderColor: toneAt('warn', 0.5), color: TONE.warn.color }}
            >
              ⚠ {w.reason}
              {w.remedy && <span className="text-fgMuted">（建议：{w.remedy}）</span>}
            </p>
          ))}
        </div>
      )}

      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
        模块交付四件套：后端接口（按持久层出 MyBatis-Plus / JPA 变体）+ 前端管理页（跟随 ⑤）+
        建表 DDL（追加进迁移脚本）+ 种子数据（admin / admin123，首次登录后请修改）。
      </p>
    </StepShell>
  );
}

const STEP_SPEC = {
  id: 'modules',
  route: '/stack/step/modules',
  glyph: '⛁',
  name: '功能模块',
  section: 'frontend-env',
  question: '要把哪些现成功能模块搭进去？',
  feeds: '每个模块 = 后端接口 + 前端管理页 + 建表种子 SQL（admin/admin123）。依赖随勾选自动装上（清单里标「自动带上」）；与选型冲突的组合会标黄并给修复建议。',
} as const satisfies StepSpec;
