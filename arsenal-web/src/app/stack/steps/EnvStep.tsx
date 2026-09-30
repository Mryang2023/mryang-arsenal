'use client';

import StepShell from './StepShell';
import type { EnvFormSpec, EnvValues } from '@/lib/scaffold/contracts';
import type { StepSpec } from '../wizard';
import { TONE } from '../palette';

/**
 * ⑥ 环境与连接：数据库 / Redis / Nacos 的连接信息。
 *
 * 三条边界都写在界面上：
 *  - 值只烘进导出包（占位符默认值位），环境变量仍可覆盖；不上传任何东西；
 *  - 密码默认不写入本机 localStorage，勾「记住到本机」才存；
 *  - 演示模式（H2 内存库）：什么都不填也能起 —— 兜底是可用性，不是替代真库。
 *
 * ── 连接三态卡（P1，2026-09-30）──
 * 以前这三种处境藏在表单深处：一个「演示模式」勾选框在最上面、
 * 「密码默认不落盘」的说明沉在最底下，中间是四组输入框 ——
 * 用户要读完整个表单才知道「我现在到底处在哪一种」。
 * 现在把三态提到表单之前，三张卡常驻、当前态高亮：
 *
 *   演示模式（H2）  ·  远端自填  ·  本机默认（占位符）
 *
 * **当前态是从数据推出来的，不是另存一份开关**：
 * `demoMode` 为真是演示；关掉演示且必填都填了是远端自填；关掉演示但有必填留空
 * 就是本机默认（导出时回落占位符默认值）。所以「切到演示再切回来」
 * 不会把已填内容洗掉 —— 值一直留在通道里，只是表单整段折叠。
 * 点「本机默认」是**唯一的破坏性动作**（回落占位符），且它只清非密码字段，
 * 密码类字段按「记住到本机」的既有规则处理，不在这里另立一套。
 */
export default function EnvStep({
  forms,
  values,
  demoMode,
  rememberSecrets,
  onChange,
  onDemoMode,
  onRememberSecrets,
  onUseDefaults,
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
  /** 回落占位符默认：清空**非密码**必填字段（密码类走既有落盘规则） */
  onUseDefaults: () => void;
  /** 必填缺失的字段 label（父组件已算好），有值时顶部黄条提示 */
  missing: string[];
}) {
  const dbForm = forms.find((f) => f.id === 'database');
  const others = forms.filter((f) => f.id !== 'database');

  // 当前态：从数据推，不另存开关。必填字段集合也取自表单事实源，不写死数字。
  const requiredKeys = forms.flatMap((f) => f.fields).filter((f) => f.required).map((f) => f.key);
  const filledRequired = requiredKeys.filter((k) => (values[k] ?? '') !== '').length;
  const allRequiredFilled = requiredKeys.length > 0 && filledRequired === requiredKeys.length;
  const mode: EnvMode = demoMode ? 'demo' : allRequiredFilled ? 'remote' : 'local';

  return (
    <StepShell spec={STEP_SPEC}>
      <div className="space-y-3 p-4">
        {/* ── 连接三态卡：先回答「我现在处在哪一种」，再填表单 ── */}
        <div
          data-env-modes=""
          className="grid gap-2 sm:grid-cols-3"
          aria-label="连接方式三选一"
        >
          {ENV_MODES.map((m) => {
            const on = mode === m.id;
            const t = m.id === 'demo' ? TONE.info : m.id === 'remote' ? TONE.ok : TONE.warn;
            return (
              <button
                key={m.id}
                type="button"
                data-env-mode={m.id}
                aria-pressed={on}
                onClick={() => {
                  if (m.id === 'demo') onDemoMode(true);
                  else if (m.id === 'remote') onDemoMode(false);
                  else {
                    onDemoMode(false);
                    onUseDefaults();
                  }
                }}
                title={m.hint}
                className="flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors"
                style={{
                  borderColor: on ? t.border : '#243029',
                  background: on ? t.soft : 'transparent',
                }}
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className="mono text-[12px] leading-none" style={{ color: on ? t.color : '#93A39C' }}>
                    {m.glyph}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-[11px] font-medium leading-[16px]"
                    style={{ color: on ? '#E8F0EC' : '#93A39C' }}
                  >
                    {m.name}
                  </span>
                  {on && (
                    <span className="mono shrink-0 text-[10px] leading-none" style={{ color: t.color }}>
                      当前
                    </span>
                  )}
                </span>
                <span className="text-[10px] leading-[15px] text-fgMuted">{m.desc}</span>
              </button>
            );
          })}
        </div>

        {/* ── 密码默认不落盘：从表单最底部提到三态卡旁 ──
             「填了密码才发现它不存」是这条边界唯一会伤人的时机，
             所以它必须出现在用户开始填第一个字段之前。 */}
        <label
          data-secret-note=""
          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3"
        >
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
            演示模式下数据库表单折叠 —— 导出包不连外部库。取消勾选即可恢复（已填的内容一直留着）。
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
      </div>
    </StepShell>
  );
}

type EnvMode = 'demo' | 'remote' | 'local';

const ENV_MODES: { id: EnvMode; glyph: string; name: string; desc: string; hint: string }[] = [
  {
    id: 'demo',
    glyph: '⌬',
    name: '演示模式 · H2 内存库',
    desc: '零外部依赖，导出包直接起。数据重启即清，只用于演示。',
    hint: '勾上后忽略数据库表单，导出包用 --spring.profiles.active=demo 启动',
  },
  {
    id: 'remote',
    glyph: '⛓',
    name: '远端自填 · 真实连接',
    desc: '填了才烘进导出包；环境变量仍可在部署时覆盖。',
    hint: '把必填连接信息填完即进入这一态',
  },
  {
    id: 'local',
    glyph: '⌁',
    name: '本机默认 · 占位符回落',
    desc: '留空也能导出，值回落占位符默认 —— 后端可能连不上库。',
    hint: '清空非密码的必填字段，回落到占位符默认值',
  },
];

const STEP_SPEC = {
  id: 'env',
  glyph: '⌁',
  name: '环境与连接',
  section: 'frontend-env',
  question: '数据库 / Redis / Nacos 连哪里？连接信息烘进导出包，环境变量仍可覆盖。',
  feeds: '填了 → 零配置直连；不填 → 本机默认；演示模式 → H2 内存库。',
} as const satisfies StepSpec;
