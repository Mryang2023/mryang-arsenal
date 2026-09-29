'use client';

import { moduleList, moduleStats } from '@/lib/scaffold/module-registry';
import type { ModuleDef, ModuleWarning } from '@/lib/scaffold/contracts';
import StepShell from './StepShell';
import type { StepSpec } from '../wizard';

/**
 * ⑦ 功能模块：勾选要搭进去的现成功能。
 *
 * 勾选联动在父组件做（勾 role/menu 自动带 user）—— 这里只渲染结果：
 * 每张卡展示交付物统计（接口/表/页面/文件），冲突与缺依赖以黄条列出并给修复建议。
 * 灰显不隐藏：模块今天就这三个，没有的模块不做「敬请期待」的空卡。
 */
export default function ModulesStep({
  selectedIds,
  warnings,
  onToggle,
}: {
  /** 依赖闭包解析后的最终选中集（含被自动带上的模块） */
  selectedIds: string[];
  warnings: ModuleWarning[];
  onToggle: (id: string) => void;
}) {
  const defs = moduleList();
  const byId = new Map<string, ModuleDef>(defs.map((d) => [d.id, d]));

  return (
    <StepShell spec={STEP_SPEC}>
      <div className="grid gap-2.5 p-4 md:grid-cols-3">
        {defs.map((def) => {
          const on = selectedIds.includes(def.id);
          const stats = moduleStats(def);
          return (
            <button
              key={def.id}
              type="button"
              data-module={def.id}
              aria-pressed={on}
              onClick={() => onToggle(def.id)}
              className="rounded-lg border p-3 text-left transition-colors"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold leading-tight text-fg">{def.name}</span>
                <span className="mono text-[10px] text-fgFaint">{on ? '已选' : '未选'}</span>
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{def.description}</p>
              <p className="mono mt-2 text-[10px] leading-relaxed text-fgFaint">
                {stats.endpoints} 接口 · {stats.tables} 表 · {stats.menus} 菜单页 · {stats.files} 文件
              </p>
              {def.menus.length > 0 && (
                <p className="mono mt-1 text-[10px] text-fgFaint">
                  页面：{def.menus.map((m) => m.path).join(' ')}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1.5 border-t border-line px-4 py-3" data-module-warnings="">
          {warnings.map((w, i) => (
            <p
              key={i}
              className="rounded-md border px-3 py-2 text-2xs leading-relaxed"
              style={{ borderColor: 'rgba(217,164,65,0.5)', color: '#D9A441' }}
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
  glyph: '⛁',
  name: '功能模块',
  section: 'frontend-env',
  question: '要把哪些现成功能模块搭进去？',
  feeds: '每个模块 = 后端接口 + 前端管理页 + 建表种子 SQL；勾 role/menu 自动带上 user。',
} as const satisfies StepSpec;
