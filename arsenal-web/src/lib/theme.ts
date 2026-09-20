import type { CategoryKey, Severity, CheckLayer } from './types';

export interface CategoryTheme {
  key: CategoryKey;
  name: string;
  english: string;
  color: string;
  blurb: string;
  glyph: string;
}

/** 九大类的识别色。用内联色值而非 Tailwind 类，避免动态类名被 purge 掉。 */
export const CATEGORY_THEME: Record<CategoryKey, CategoryTheme> = {
  skeleton:    { key: 'skeleton',    name: '工程骨架', english: 'Skeleton',    color: '#8B9DC3', blurb: '项目结构、包命名、依赖与配置', glyph: '▤' },
  web:         { key: 'web',         name: 'Web 层',   english: 'Web',         color: '#4FB0C6', blurb: 'Controller 职责、入参出参契约、校验出口', glyph: '⇄' },
  service:     { key: 'service',     name: '业务层',   english: 'Service',     color: '#7FA650', blurb: '分层边界、事务、注入与业务异常', glyph: '⚙' },
  data:        { key: 'data',        name: '数据层',   english: 'Data',        color: '#C9A227', blurb: 'SQL 写法、表结构、索引与分页', glyph: '▦' },
  concurrency: { key: 'concurrency', name: '并发',     english: 'Concurrency', color: '#E5734B', blurb: '线程池、ThreadLocal、时间格式化', glyph: '⇉' },
  reliability: { key: 'reliability', name: '可靠性',   english: 'Reliability', color: '#B085D6', blurb: '异常、日志、重试退避与超时', glyph: '◈' },
  security:    { key: 'security',    name: '安全',     english: 'Security',    color: '#E5484D', blurb: '注入、反序列化、凭据与脱敏', glyph: '⛨' },
  test:        { key: 'test',        name: '测试',     english: 'Test',        color: '#56C596', blurb: '测试结构、命名与断言', glyph: '✓' },
  collab:      { key: 'collab',      name: '协作',     english: 'Collab',      color: '#9C8AA5', blurb: 'Git 提交、分支与文档约定', glyph: '⎇' },
};

export const CATEGORY_ORDER: CategoryKey[] = [
  'skeleton', 'web', 'service', 'data', 'concurrency',
  'reliability', 'security', 'test', 'collab',
];

export interface SeverityTheme {
  label: string;
  code: Severity;
  color: string;
  soft: string;
  meaning: string;
  /** 是否与 MUST 同级阻断 */
  blocking: boolean;
  penalty: number;
}

export const SEVERITY_THEME: Record<Severity, SeverityTheme> = {
  MUST:   { label: '强制', code: 'MUST',   color: '#E5484D', soft: 'rgba(229,72,77,0.13)',   meaning: '硬约束。违反必修，计入合规分。',       blocking: true,  penalty: 6 },
  NEVER:  { label: '禁止', code: 'NEVER',  color: '#C026D3', soft: 'rgba(192,38,211,0.13)',  meaning: '明令禁止。与强制同级阻断。',           blocking: true,  penalty: 6 },
  SHOULD: { label: '建议', code: 'SHOULD', color: '#D9A441', soft: 'rgba(217,164,65,0.13)',  meaning: '强烈建议。违反不计分，报告中列出。',   blocking: false, penalty: 2 },
  MAY:    { label: '可选', code: 'MAY',    color: '#6E8FA8', soft: 'rgba(110,143,168,0.13)', meaning: '可选风格。仅作提示词参考，不参与校验。', blocking: false, penalty: 0 },
};

export const SEVERITY_ORDER: Severity[] = ['MUST', 'NEVER', 'SHOULD', 'MAY'];

export const CHECK_LAYER_THEME: Record<CheckLayer, { label: string; color: string; desc: string; auto: boolean }> = {
  regex:  { label: '正则',   color: '#56C596', desc: '文本层，零成本即时判定', auto: true },
  ast:    { label: 'AST',    color: '#4FB0C6', desc: '语法树层，需 Java 解析器', auto: false },
  llm:    { label: '语义',   color: '#B085D6', desc: 'LLM 判定，必须带行号定位', auto: false },
  manual: { label: '人工',   color: '#8B9DC3', desc: '无法自动判定，需人工过目', auto: false },
};

/**
 * 代码分层识别色。用于案例详情页把「这条代码属于哪一层」变成一眼可见。
 *
 * 配色刻意贴近分层语义：越靠近用户越偏冷（client/web），
 * 越靠近存储越偏暖（repo/domain/sql），中间业务层用绿色。
 */
export const LAYER_THEME: Record<string, { label: string; color: string; glyph: string }> = {
  client:      { label: '客户端',   color: '#6E8FA8', glyph: '◁' },
  web:         { label: '接口层',   color: '#4FB0C6', glyph: '⇄' },
  'dto-in':    { label: '入参 DTO', color: '#5FB8A6', glyph: '→' },
  'dto-out':   { label: '出参 DTO', color: '#56C596', glyph: '←' },
  service:     { label: '业务层',   color: '#7FA650', glyph: '⚙' },
  repo:        { label: '数据访问', color: '#C9A227', glyph: '▦' },
  domain:      { label: '实体',     color: '#B08A5A', glyph: '◈' },
  exception:   { label: '异常',     color: '#E5484D', glyph: '⚠' },
  common:      { label: '公共',     color: '#8B9DC3', glyph: '▫' },
  config:      { label: '配置',     color: '#D9A441', glyph: '⚒' },
  structure:   { label: '结构',     color: '#9C8AA5', glyph: '▥' },
  sql:         { label: 'SQL',      color: '#C9A227', glyph: '▤' },
  test:        { label: '测试',     color: '#56C596', glyph: '✓' },
  concurrency: { label: '并发',     color: '#E5734B', glyph: '⇉' },
  integration: { label: '外部集成', color: '#B085D6', glyph: '⇋' },
};

export function layerTheme(layer: string) {
  return LAYER_THEME[layer] ?? { label: layer, color: '#8B9DC3', glyph: '·' };
}

/**
 * 来源类型的中文标签 —— **不在这里了**。
 *
 * 它曾经是本文件里的一个常量表，与 arsenal-rules/meta.json 的 `sourceTypes` 各存一份。
 * 后端导出规范书时读 meta.json，前端读这份表，两边靠「记得一起改」维持一致 ——
 * 而且这个字段一度根本没被 sync-rules.mjs 透传到前端（白名单漏了它），
 * 也就是「共读同一份数据」当时只成立了一半。
 *
 * 现在统一走 `@/lib/rules` 的 `sourceTypeLabel()`，数据源是 meta.sourceTypes。
 * 后端 RulesetMeta.sourceTypeLabel 读同一份数据，兜底口径逐字对齐：
 * 类型缺失 → 「来源」，类型不认识 → 原样露出原始 key。
 *
 * 刻意不在这里 re-export：rules.ts 要 import 本文件的 CATEGORY_ORDER，
 * 再反向引回去就成环了。
 */
