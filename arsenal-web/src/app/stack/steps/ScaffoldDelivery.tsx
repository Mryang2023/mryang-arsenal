'use client';

import { downloadZip } from '@/lib/zip';
import type { LintViolation } from '@/lib/export-lint';
import type { EnvFormSpec, EnvValues, ExportArtifacts, ModuleDef } from '@/lib/scaffold/contracts';
import type { StepSpec } from '../wizard';
import StepShell from './StepShell';
import { TONE, toneAt } from '../palette';

/**
 * 包里装了什么 —— 从 files **现算**，不写死一句「包含后端与前端」。
 *
 * 顶层是目录的记成 `src/ 12`，是文件的直接记名字；只取前 5 项，剩下的合成
 * `+N 项`。写死构成 = 事实源改了而卡上不动，「下载下来发现和说的不一样」。
 */
function topOf(files: { path: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const seg = f.path.includes('/') ? `${f.path.split('/')[0]}/` : f.path;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = rows.slice(0, 5).map(([k, n]) => (k.endsWith('/') ? `${k} ${n}` : k));
  const rest = rows.length - head.length;
  return rest > 0 ? [...head, `+${rest} 项`] : head;
}

/**
 * ⑩ 交付 · 双包面板（放在既有九页签预览之前）：
 *
 * 三张下载卡（后端 / 前端 / 全家桶）+ 环境清单（密码打码）+ 模块清单 + 三档启动指南。
 * 这是「选完就拿走」的终点面板 —— 九页签回答「长什么样」，这里回答「怎么拿、怎么跑」。
 *
 * 导出预检闸：violations 非空 = 这份包打出来也跑不起来（同名 bean / 悬空
 * import / 无版本依赖…）。此时下载全部禁用、问题清单直接亮在台面 ——
 * 宁可不交付，不发一份用户解包才发现起不来的包（09-29 三轮事故的教训）。
 */
export default function ScaffoldDelivery({
  artifacts,
  demoMode,
  modules,
  forms,
  values,
}: {
  artifacts: ExportArtifacts;
  demoMode: boolean;
  modules: ModuleDef[];
  forms: EnvFormSpec[];
  values: EnvValues;
}) {
  const secretKeys = new Set(forms.flatMap((f) => f.fields.filter((x) => x.secret).map((x) => x.key)));
  const envRows = Object.entries(values).filter(([, v]) => v !== '');
  const violations = artifacts.violations;
  const blocked = violations.length > 0;

  const download = (art: { name: string; files: { path: string; content: string }[] } | undefined) => {
    if (!art || blocked) return;
    downloadZip(
      art.files.map((f) => ({ path: f.path, content: f.content })),
      art.name,
    );
  };

  const appName = artifacts.backend.name.replace(/-backend\.zip$/, '');

  return (
    <section className="panel overflow-hidden" data-scaffold-delivery="">
      <header className="border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold leading-[18px] text-fg">
          双包交付 —— 三个包都能直接跑
        </h2>
        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
          后端包填好了连接信息（见下），前端包两步起步，全家桶一条 <span className="mono">docker compose up</span> 起全套。
        </p>
      </header>

      {blocked && (
        <div className="border-b border-rose-500/30 bg-rose-500/5 px-4 py-3" data-export-blocked="">
          <p className="text-[12px] font-semibold leading-[17px] text-rose-400">
            导出被预检闸拦截 —— 当前组合打出的包跑不起来，已禁止下载
          </p>
          <ul className="mt-1.5 space-y-1">
            {violations.map((v, i) => (
              <li key={`${v.check}-${i}`} className="text-2xs leading-relaxed text-fgMuted">
                <span className="mono text-rose-400">[{v.check}]</span> {v.message}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs text-fgFaint">
            修好上面的问题（通常是调整选型组合，或内容源缺一条修复）后，这里会自动恢复下载。
          </p>
        </div>
      )}

      {/*
        三张卡**不平级**：全家桶是主卡（一行、铜色边框、默认那一眼），
        后端 / 前端是次卡（并排在它下面）。

        为什么不平铺三等分：第一次来的人问的是「我该点哪个」，三张一样大的卡
        等于把这个问题的答案推给了用户。全家桶 = 后端 + 前端 + compose + 种子，
        一条 `docker compose up` 起全套，是绝大多数场景的答案；只用后端包的人
        是**知道自己只要后端**的人，次卡他照样找得到。
      */}
      <div className="space-y-2.5 p-4">
        <button
          type="button"
          data-download="all"
          data-download-tier="primary"
          disabled={blocked}
          onClick={() => download(artifacts.all)}
          className={`block w-full rounded-lg border p-3.5 text-left transition-colors ${
            blocked ? 'cursor-not-allowed opacity-40' : 'hover:border-brass'
          }`}
          style={{ borderColor: blocked ? undefined : toneAt('warn', 0.6) }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="text-[13px] font-semibold leading-[18px] text-fg">全家桶</p>
            <span
              className="mono rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px]"
              style={{ color: TONE.warn.color, background: toneAt('warn', 0.14) }}
            >
              推荐
            </span>
            <span className="mono ml-auto text-[10px] leading-[15px] text-fgFaint">
              {artifacts.all.name} · {artifacts.all.files.length} 文件
            </span>
          </div>
          <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">
            backend/ + frontend/ + compose + 建表种子 —— 解压后一条{' '}
            <span className="mono">docker compose up</span> 起全套（前端 :80、后端 :8080）。
          </p>
          <p className="mono mt-1.5 text-[10px] leading-[15px] text-fgFaint">
            {topOf(artifacts.all.files).join(' · ')}
          </p>
        </button>

        <div className="grid gap-2.5 md:grid-cols-2">
          <button
            type="button"
            data-download="backend"
            data-download-tier="secondary"
            disabled={blocked}
            onClick={() => download(artifacts.backend)}
            className={`rounded-lg border border-line p-3 text-left transition-colors ${
              blocked ? 'cursor-not-allowed opacity-40' : 'hover:border-brass'
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <p className="text-[12px] font-semibold leading-[17px] text-fg">只拿后端</p>
              <span className="mono ml-auto text-[10px] leading-[15px] text-fgFaint">
                {artifacts.backend.files.length} 文件
              </span>
            </div>
            <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
              <span className="mono">mvn spring-boot:run</span> 直接起（连接信息已烘入；演示档另附 H2 profile）。
            </p>
            <p className="mono mt-1 text-[10px] leading-[15px] text-fgFaint">
              {topOf(artifacts.backend.files).join(' · ')}
            </p>
          </button>

          {artifacts.frontend ? (
            <button
              type="button"
              data-download="frontend"
              data-download-tier="secondary"
              disabled={blocked}
              onClick={() => download(artifacts.frontend)}
              className={`rounded-lg border border-line p-3 text-left transition-colors ${
                blocked ? 'cursor-not-allowed opacity-40' : 'hover:border-brass'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <p className="text-[12px] font-semibold leading-[17px] text-fg">只拿前端</p>
                <span className="mono ml-auto text-[10px] leading-[15px] text-fgFaint">
                  {artifacts.frontend.files.length} 文件
                </span>
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
                <span className="mono">npm install && npm run dev</span> → admin / admin123 登录。
              </p>
              <p className="mono mt-1 text-[10px] leading-[15px] text-fgFaint">
                {topOf(artifacts.frontend.files).join(' · ')}
              </p>
            </button>
          ) : (
            <div className="rounded-lg border border-line p-3 opacity-60" data-download-tier="secondary">
              <p className="text-[12px] font-semibold leading-[17px] text-fg">只拿前端</p>
              <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
                未选前端基底 —— 这一趟只有后端包。
              </p>
            </div>
          )}
        </div>

        <p className="text-[10px] leading-[15px] text-fgFaint">
          三张卡打的是同一套选型，区别只在打包范围 —— 后端包里烘进去的连接信息与全家桶里的一致。
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-3 border-t border-line px-4 py-3.5 md:grid-cols-2">
        <div>
          <p className="mono text-[11px] text-brass">环境清单（密码已打码）</p>
          {envRows.length === 0 ? (
            <p className="mt-1.5 text-2xs text-fgMuted">
              未填写 —— 占位符保持本机默认{demoMode ? '；演示模式已勾选，后端不连外部库' : ''}。
            </p>
          ) : (
            <ul className="mono mt-1.5 space-y-0.5 text-[10px] leading-relaxed text-fgMuted">
              {envRows.map(([k, v]) => (
                <li key={k}>
                  {k} = {secretKeys.has(k) ? '••••••' : v}
                </li>
              ))}
              {demoMode && <li className="text-brass">演示模式：导出包含 application-demo.yml（H2）</li>}
            </ul>
          )}
          <p className="mono mt-2 text-[11px] text-brass">
            功能模块（{modules.length}）
          </p>
          {modules.length === 0 ? (
            <p className="mt-1 text-2xs text-fgMuted">未勾选 —— 导出包含基础脚手架与示例 user 领域。</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-2xs leading-relaxed text-fgMuted">
              {modules.map((m) => (
                <li key={m.id}>
                  ✓ {m.name}（{m.endpoints} 接口 · {m.tables.join('/')}）
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mono text-[11px] text-brass">三档启动指南（导出包 README 里有完整版）</p>
          <ol className="mt-1.5 space-y-2 text-2xs leading-relaxed text-fgMuted">
            <li>
              <span className="mono text-fg">本机直跑</span>：解压后端包 →{' '}
              <span className="mono">mvn spring-boot:run</span> →{' '}
              <span className="mono">curl localhost:8080/actuator/health</span> 应为 UP；前端包{' '}
              <span className="mono">npm install && npm run dev</span>。
            </li>
            <li>
              <span className="mono text-fg">演示模式</span>：后端包{' '}
              <span className="mono">java -jar *.jar --spring.profiles.active=demo</span>（H2 内存库，零配置）。
            </li>
            <li>
              <span className="mono text-fg">全家容器</span>：解压全家桶 →{' '}
              <span className="mono">docker compose -f compose/docker-compose.yml up -d --build</span>，
              前端 :80、后端 :8080。初始账号 <span className="mono text-brass">admin / admin123</span>。
            </li>
          </ol>
          <p className="mt-2 text-2xs text-fgFaint">项目名 {appName} —— 与 pom artifactId、库名默认值同源。</p>
        </div>
      </div>
    </section>
  );
}
