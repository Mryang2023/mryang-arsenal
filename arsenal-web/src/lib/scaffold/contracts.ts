/**
 * 脚手架生成器的共享契约。类型只在这里定义一份，UI（第四棒）与
 * verify:scaffold 都从这里 import —— 字段名与 module.json/DTO 实测对齐。
 */
import type { ExportFile } from '@/lib/project';
import type { LintViolation } from '@/lib/export-lint';

/** 环境表单的一个字段（schema 来自 stack.json 顶层 envForms） */
export interface EnvFieldSpec {
  key: string;
  label: string;
  required: boolean;
  default: string;
  placeholder?: string;
  /** 该维度某选项下默认值不同（如 db.port 在 mysql=3306 / postgres=5432） */
  defaultByOption?: Record<string, string>;
  /** 密码类：默认不持久化到 localStorage */
  secret?: boolean;
}

export interface EnvFormSpec {
  id: string;
  triggerDim: string;
  triggerOptions: string[];
  title: string;
  fields: EnvFieldSpec[];
}

/** 前端选型（stack.json 顶层 frontend，刻意不走维度体系，见 stack_frontend.py） */
export interface FrontendBase {
  id: string;
  name: string;
  badge?: string;
  uncovered?: boolean;
  summary: string;
}

/** 同一前端基底下的 UI 模板（stack.json frontend.templates，2026-10-03）。
 *  模板本体 = arsenal-scaffold/frontend/<base>/<id>/ 文件树；default 标记兜底值 */
export interface FeUiTemplate {
  id: string;
  name: string;
  summary: string;
  default?: boolean;
}

/** 用户在「环境与连接」步骤填的值：key → 字符串 */
export type EnvValues = Record<string, string>;

export interface EnvInput {
  values: EnvValues;
  demoMode: boolean;
}

export interface FrontendChoice {
  base: string;
}

/** 模块清单（来自 modules/&lt;id&gt;/module.json，构建期打进 scaffold-templates.ts） */
export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  requires: string[];
  tables: string[];
  endpoints: number;
  menus: { title: string; path: string; permission: string; icon?: string }[];
  backendFiles: string[];
}

export interface ModuleWarning {
  module: string;
  reason: string;
  /** 给一键修复的建议动作（改哪个维度的哪个选项） */
  remedy?: string;
}

export interface ExportArtifact {
  name: string;
  files: ExportFile[];
  bytes: number;
}

export interface ExportArtifacts {
  backend: ExportArtifact;
  frontend?: ExportArtifact;
  all: ExportArtifact;
  /**
   * 导出预检闸（export-lint）对后端包清单的终检结果。
   * 非空 = 这份包打出来也跑不起来 —— 交付面板据此禁用下载并在台面亮出问题清单。
   */
  violations: LintViolation[];
}

/** 占位符白名单 —— 渲染器只替换这些名字，其余 {{...}} 一律原样保留 */
export const PLACEHOLDER_KEYS = [
  'basePackage',
  'basePackagePath',
  'artifactId',
  'appName',
  'backendBaseUrl',
  'dbImage',
] as const;

export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

export type TemplateVars = Record<PlaceholderKey, string>;
