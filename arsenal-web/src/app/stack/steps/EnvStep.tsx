'use client';

import StepShell from './StepShell';
import type { EnvFormSpec, EnvValues } from '@/lib/scaffold/contracts';
import type { StepSpec } from '../wizard';

/**
 * ⑥ 环境与连接：数据库 / Redis / Nacos 的连接信息。
 *
 * 三条边界都写在界面上：
 *  - 值只烘进导出包（占位符默认值位），环境变量仍可覆盖；不上传任何东西；
 *  - 密码默认不写入本机 localStorage，勾「记住到本机」才存；
 *  - 演示模式（H2 内存库）：什么都不填也能起 —— 兜底是可用性，不是替代真库。
 */
export default function EnvStep({
  forms,
  values,
  demoMode,
  rememberSecrets,
  onChange,
  onDemoMode,
  onRememberSecrets,
  missing,
}: {
  forms: EnvFormSpec[];
  /** 全量值（含密码类字段），由父组件把默认值 + 草稿合并好 */
  values: EnvValues;
  demoMode: boolean;
  rememberSecrets: boolean;
  onChange: (key: string, value: string) => void;
  onDemoMode: (on: boolean) => void;
  onRememberSecrets: (on: boolean) => void;
  /** 必填缺失的字段 label（父组件已算好），有值时顶部黄条提示 */
  missing: string[];
}) {
  const dbForm = forms.find((f) => f.id === 'database');
  const others = forms.filter((f) => f.id !== 'database');

  return (
    <StepShell spec={STEP_SPEC}>
      <div className="space-y-3 p-4">
        {missing.length > 0 && (
          <p
            data-env-missing=""
            className="rounded-md border px-3 py-2 text-2xs leading-relaxed"
            style={{ borderColor: 'rgba(217,164,65,0.5)', color: '#D9A441' }}
          >
            必填未填：{missing.join('、')} —— 仍可导出（占位符回退默认值），但后端可能连不上库。
          </p>
        )}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            data-demo-mode=""
            checked={demoMode}
            onChange={(e) => onDemoMode(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-relaxed text-fg">
            演示模式（H2 内存库）
            <span className="mt-1 block text-2xs leading-relaxed text-fgMuted">
              勾上后忽略数据库表单，导出包用 <span className="mono">--spring.profiles.active=demo</span> 启动，
              零外部依赖就能登录演示。数据重启即清，MySQL 方言行为有差异 —— 只用于演示，不是生产参照。
            </span>
          </span>
        </label>

        {!demoMode && dbForm && (
          <fieldset className="rounded-lg border border-line p-3" data-env-form="database">
            <legend className="mono px-1.5 text-[11px] text-brass">{dbForm.title}</legend>
            <div className="grid gap-2.5 md:grid-cols-2">
              {dbForm.fields.map((f) => (
                <label key={f.key} className="block text-2xs text-fgMuted">
                  <span className="mb-1 block">
                    {f.label}
                    {f.required && <span className="text-[#E5484D]"> *</span>}
                  </span>
                  <input
                    data-env-key={f.key}
                    type={f.secret ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder ?? ''}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    className="w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-xs text-fg outline-none focus:border-brass"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {demoMode && (
          <p className="rounded-lg border border-line px-3 py-2.5 text-2xs leading-relaxed text-fgMuted" data-demo-collapsed="">
            演示模式下数据库表单折叠 —— 导出包不连外部库。取消勾选即可恢复。
          </p>
        )}

        {others.map((form) => (
          <fieldset key={form.id} className="rounded-lg border border-line p-3" data-env-form={form.id}>
            <legend className="mono px-1.5 text-[11px] text-brass">{form.title}</legend>
            <div className="grid gap-2.5 md:grid-cols-3">
              {form.fields.map((f) => (
                <label key={f.key} className="block text-2xs text-fgMuted">
                  <span className="mb-1 block">{f.label}</span>
                  <input
                    data-env-key={f.key}
                    type={f.secret ? 'password' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    className="w-full rounded-md border border-line bg-transparent px-2 py-1.5 text-xs text-fg outline-none focus:border-brass"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            data-remember-secrets=""
            checked={rememberSecrets}
            onChange={(e) => onRememberSecrets(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-relaxed text-fg">
            把密码记住到本机
            <span className="mt-1 block text-2xs leading-relaxed text-fgMuted">
              默认不记住：刷新页面后密码清空，其余字段保留。勾选后密码存进本机浏览器
              （localStorage，不上传），换机器 / 清浏览器数据即失效。
            </span>
          </span>
        </label>
      </div>
    </StepShell>
  );
}

const STEP_SPEC = {
  id: 'env',
  glyph: '⌁',
  name: '环境与连接',
  section: 'frontend-env',
  question: '数据库 / Redis / Nacos 连哪里？连接信息烘进导出包，环境变量仍可覆盖。',
  feeds: '填了 → 零配置直连；不填 → 本机默认；演示模式 → H2 内存库。',
} as const satisfies StepSpec;
