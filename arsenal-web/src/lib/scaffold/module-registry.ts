/**
 * 功能模块注册表：勾了什么、缺什么依赖、什么组合不成立。
 * 数据源 = modules/&lt;id&gt;/module.json（构建期打进 SCAFFOLD_MODULES）。
 */
import { SCAFFOLD_MODULES } from '@/generated/scaffold-templates';
import type { ModuleDef, ModuleWarning } from './contracts';

export function moduleList(): ModuleDef[] {
  return Object.values(SCAFFOLD_MODULES) as ModuleDef[];
}

export function moduleById(id: string): ModuleDef | undefined {
  return (SCAFFOLD_MODULES as Record<string, ModuleDef>)[id];
}

/**
 * 解析勾选结果：
 *  - 依赖闭包（勾 role/menu 自动带上 user）；
 *  - 缺依赖给出 warning（UI 标黄 + 一键补）；
 *  - 与后端选型冲突的组合给出 warning（不静默生成坏代码）。
 */
export function resolveModules(
  picked: string[],
  stackPicks: Record<string, string | undefined>,
  feBase = 'vue3-vite',
): { selected: ModuleDef[]; warnings: ModuleWarning[] } {
  const warnings: ModuleWarning[] = [];
  const chosen = new Set<string>();

  const addWithDeps = (id: string) => {
    if (chosen.has(id)) return;
    chosen.add(id);
    const def = moduleById(id);
    for (const dep of def?.requires ?? []) addWithDeps(dep);
  };
  for (const id of picked) {
    if (!moduleById(id)) {
      warnings.push({ module: id, reason: '未知模块 id —— module.json 清单里没有它' });
      continue;
    }
    addWithDeps(id);
  }

  // 模块代码依赖 auth 基础设施（自研 JWT 拦截器）；satoken 有自己的鉴权栈，不能混装
  if (chosen.size > 0 && stackPicks.auth === 'satoken') {
    warnings.push({
      module: 'auth',
      reason: '模块体系的登录/RBAC 基于自研 JWT 拦截器，与 Sa-Token 的鉴权栈冲突',
      remedy: 'auth 改为 securityjwt 或 custom',
    });
  }
  // securityjwt 与模块体系不再冲突（09-29 起 backend-plan 在 securityjwt 组合下
  // 剔除骨架简版鉴权件，SecurityConfig/WebMvcConfig 换模块接管版）——
  // 曾因两套 JwtAuthenticationFilter/AuthInterceptor 同名 bean 冲突启动即崩。
  // 模块仓储按 mybatisplus/jpa 两叉交付；jdbc 直写 SQL 没有对应实现
  if (chosen.size > 0 && stackPicks.persistence === 'jdbc') {
    warnings.push({
      module: 'persistence',
      reason: '功能模块的仓储按 MyBatis-Plus 与 JPA 两个变体交付，jdbc 直写没有对应实现',
      remedy: '持久层改为 mybatisplus 或 jpa',
    });
  }
  // 勾了模块但前端选「无前端」：后端接口照出，管理页面没有落点
  if (chosen.size > 0 && feBase === 'none') {
    warnings.push({
      module: 'frontend',
      reason: '已勾选功能模块但没有前端 —— 管理页面没有落点，只能裸调接口',
      remedy: '前端技术栈选 vue3-vite',
    });
  }

  const selected = [...chosen].map((id) => moduleById(id)!).filter(Boolean);
  return { selected, warnings };
}

/** 模块卡片用的交付物统计（N 接口 + N 表 + N 菜单项 + N 文件） */
export function moduleStats(def: ModuleDef) {
  return {
    endpoints: def.endpoints,
    tables: def.tables.length,
    menus: def.menus.length,
    files: def.backendFiles.length,
  };
}
