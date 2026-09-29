/**
 * 环境表单：按选型给出要填什么、默认值是什么、值合不合法。
 * schema 来自 stack.json 顶层 envForms（tools/content/stack_frontend.py）。
 */
import stackRaw from '@/generated/stack.json';
import type { EnvFieldSpec, EnvFormSpec, EnvValues, FrontendBase } from './contracts';

const stack = stackRaw as unknown as {
  frontend: { bases: FrontendBase[]; defaults: Record<string, string> };
  envForms: EnvFormSpec[];
};

export const frontendBases: FrontendBase[] = stack.frontend.bases;
export const frontendDefaults = stack.frontend.defaults;
export const envForms: EnvFormSpec[] = stack.envForms;

/** 当前选型下应该出现哪些表单 */
export function formsFor(picks: Record<string, string | undefined>): EnvFormSpec[] {
  return envForms.filter((f) => {
    const picked = picks[f.triggerDim];
    return !!picked && f.triggerOptions.includes(picked);
  });
}

/** 表单默认值。defaultByOption 按「该表单触发维度选中的选项」取专属默认 */
export function defaultValues(forms: EnvFormSpec[], picks: Record<string, string | undefined>, appName: string): EnvValues {
  const out: EnvValues = {};
  for (const form of forms) {
    const opt = picks[form.triggerDim] ?? '';
    for (const field of form.fields) {
      out[field.key] = (field.defaultByOption?.[opt] ?? field.default).replace(
        '__APP_NAME__',
        appName,
      );
    }
  }
  return out;
}

/** 必填校验。返回不满足的字段 label 列表，空数组 = 通过 */
export function validateEnv(forms: EnvFormSpec[], values: EnvValues): string[] {
  const missing: string[] = [];
  for (const form of forms) {
    for (const field of form.fields) {
      if (!field.required) continue;
      if (!(values[field.key] ?? '').trim()) missing.push(`${form.title} · ${field.label}`);
    }
  }
  return missing;
}

/** 供部署/文案使用的库镜像（compose 的 {{dbImage}}） */
export function dbImageOf(database: string | undefined): string {
  return database === 'postgres' ? 'postgres:16-alpine' : 'mysql:8.0.36';
}

/** 字段 UI 元数据透出（第四棒 EnvStep 直接消费） */
export function fieldSpecsOf(form: EnvFormSpec): EnvFieldSpec[] {
  return form.fields;
}
