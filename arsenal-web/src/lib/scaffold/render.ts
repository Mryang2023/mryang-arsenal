/**
 * 模板渲染器。
 *
 * 白名单替换是这里的铁律：.vue 文件里的 Vue 插值 {{ xxx }} 与脚手架占位符
 * 同形，只有 PLACEHOLDER_KEYS 里的名字才允许被替换，其余 {{...}} 一律原样
 * 保留 —— 否则每个页面模板都会被当成占位符扫一遍，替换结果不可预期。
 * 路径也要替换：后端模板的目录段就带着 {{basePackagePath}}。
 */
import { PLACEHOLDER_KEYS, type TemplateVars } from './contracts';

export function renderText(text: string, vars: TemplateVars): string {
  let out = text;
  for (const key of PLACEHOLDER_KEYS) {
    out = out.split(`{{${key}}}`).join(vars[key]);
  }
  return out;
}

export function renderPath(p: string, vars: TemplateVars): string {
  return renderText(p, vars).replace(/\.tpl$/, '');
}

/** 找出文本里「白名单之外」的 {{...}} 占位符（verify:scaffold 的越权扫描用） */
export function findIllegalPlaceholders(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
    if (!(PLACEHOLDER_KEYS as readonly string[]).includes(m[1])) hits.push(m[1]);
  }
  return hits;
}
