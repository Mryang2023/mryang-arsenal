/**
 * 前端包生成：从 frontend/<base>/<template> 模板取文件，按「是否勾选菜单模块」
 * 装配路由双变体，渲染白名单占位符。
 *
 * 装配规则（与模板文件头注释一致，多套模板同一约定）：
 *   勾 mod-menu  → index.dynamic.ts 充当 index.ts、menus.dynamic.ts 充当 menus.ts、含 dynamic-routes.ts
 *   未勾        → index.ts、menus.ts 原样，不含 dynamic-routes
 * 动态菜单拉不到时守卫回退静态导航 —— 两种变体的页面可达性都不依赖接口。
 *
 * 多套 UI 模板（2026-10-03）：模板目录从 frontend/vue3-vite/ 挪进
 * frontend/<baseId>/<templateId>/（element-admin / naive-admin / element-topbar），
 * feUi 状态见 useStackChannel。模板目录不存在时如实返回 null ——
 * 调用方按「没有前端包」处理，不静默回落到别的模板。
 */
import type { ExportFile } from '@/lib/project';
import { SCAFFOLD_FILES } from '@/generated/scaffold-templates';
import type { TemplateVars } from './contracts';
import { renderPath, renderText } from './render';

export function buildFrontendFiles(opts: {
  vars: TemplateVars;
  withMenuModule: boolean;
  baseId: string;
  templateId: string;
}): ExportFile[] | null {
  const { vars, withMenuModule, baseId, templateId } = opts;
  if (!baseId || !templateId) return null;
  const PREFIX = `frontend/${baseId}/${templateId}/`;
  if (!Object.keys(SCAFFOLD_FILES).some((k) => k.startsWith(PREFIX))) return null;
  const out: ExportFile[] = [];

  for (const [key, content] of Object.entries(SCAFFOLD_FILES)) {
    if (!key.startsWith(PREFIX)) continue;
    // 统一剥掉 .tpl 后缀再匹配 —— SCAFFOLD_FILES 的 key 保留原始文件名，带后缀
    const rel = key.slice(PREFIX.length).replace(/\.tpl$/, '');

    // ── 变体裁剪 ─────────────────────────────────────────────
    if (rel === 'src/router/index.dynamic.ts') continue;
    if (rel === 'src/router/menus.dynamic.ts') continue;
    if (rel === 'src/router/dynamic-routes.ts' && !withMenuModule) continue;

    let finalRel = rel;
    let finalContent = content;
    if (withMenuModule && rel === 'src/router/index.ts') {
      finalContent = SCAFFOLD_FILES[`${PREFIX}src/router/index.dynamic.ts.tpl`] ?? content;
    }
    if (withMenuModule && rel === 'src/router/menus.ts') {
      finalContent = SCAFFOLD_FILES[`${PREFIX}src/router/menus.dynamic.ts.tpl`] ?? content;
    }

    out.push({
      path: renderPath(finalRel, vars),
      content: renderText(finalContent, vars),
      group: finalRel.includes('/') ? '前端源码' : '前端配置',
      from: `前端工程 · ${baseId} / ${templateId}`,
    });
  }

  if (out.length === 0) return null;
  return out;
}
