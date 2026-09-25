'use client';

import { SHAPES, STEP_BY_ID, isValidProjectName } from '../wizard';
import StepShell from './StepShell';

/**
 * ① 项目定义 —— 项目名 + 项目形态。
 *
 * 项目名不是标签：它会一路写进 pom 的 artifactId、application.yml 的
 * `spring.application.name`、README / 风险报告的标题、K8s 的 app 名，
 * 以及导出 zip 的文件名。所以这里就把它定下来，并在输入框下面写清这些去处 ——
 * 不写清，用户会以为「名字随便填」。
 *
 * 形态的出处是事实源的 `presets`（单体最小集 / 云原生微服务 / 高可用集群……），
 * 不另立一套形态表：两套形态表必然在某一处说出互相矛盾的话。
 * 形态只做一件事 —— **把后面每一步的起点填成一套像样的取舍**，
 * 之后每一格都能改；它不替用户做决定，只是让人不必从 33 个空格开始。
 */
export default function ProjectStep({
  name,
  onName,
  shapeId,
  onShape,
  dimTotal,
}: {
  name: string;
  onName: (v: string) => void;
  shapeId: string;
  onShape: (presetId: string | null) => void;
  dimTotal: number;
}) {
  const spec = STEP_BY_ID.get('project')!;
  const bad = name.trim() !== '' && !isValidProjectName(name.trim());

  return (
    <StepShell spec={spec}>
      <div className="space-y-4 p-4">
        {/* ── 项目名 ── */}
        <div>
          <label
            htmlFor="stack-project-name"
            className="mono block text-[10px] uppercase tracking-wider text-fgFaint"
          >
            项目名称
          </label>
          <input
            id="stack-project-name"
            data-project-name=""
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="例如 order-service"
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
            aria-invalid={bad || undefined}
            className="mt-1.5 w-full max-w-[320px] rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors placeholder:text-fgFaint focus:border-brass"
            style={{
              borderColor: bad ? 'rgba(229,72,77,0.6)' : '#243029',
              background: 'transparent',
              color: '#CFDCD6',
            }}
          />
          {bad ? (
            <p className="mt-1 text-[10px] leading-[15px]" style={{ color: '#E5484D' }}>
              只接受小写字母、数字与点分段（order-service 请写成 order.service），
              以字母开头 —— 它要当 Java 包名与 Maven 坐标用。
            </p>
          ) : (
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              这个名字会写进 pom 的 <code className="mono text-fgMuted">artifactId</code>、
              application.yml 的{' '}
              <code className="mono text-fgMuted">spring.application.name</code>、
              K8s / Compose 的应用名、README 与风险报告标题，以及导出 zip 的文件名。
            </p>
          )}
        </div>

        {/* ── 项目形态 ── */}
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              项目形态
            </span>
            <span className="text-[10px] leading-[15px] text-fgFaint">
              选一个最接近的起点 —— 它会预填后面每一步，全部可改
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SHAPES.map((s) => {
              const on = shapeId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-shape={s.id}
                  aria-pressed={on}
                  onClick={() => onShape(s.id)}
                  className="w-[208px] rounded-md border px-2.5 py-2 text-left transition-colors"
                  style={{
                    borderColor: on ? 'rgba(217,164,65,0.65)' : '#243029',
                    background: on ? 'rgba(217,164,65,0.09)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
                      style={{
                        borderColor: on ? '#D9A441' : '#33413A',
                        color: on ? '#D9A441' : 'transparent',
                      }}
                    >
                      ✓
                    </span>
                    <span className="truncate text-[11px] font-medium leading-[16px] text-fg">
                      {s.name}
                    </span>
                    <span className="mono ml-auto shrink-0 rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint">
                      {s.badge}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-[10px] leading-[15px] text-fgMuted">
                    {s.summary}
                  </p>
                  <p className="mono mt-1.5 text-[10px] leading-[15px] text-fgFaint">
                    预填 {s.filled}/{dimTotal} 格
                  </p>
                </button>
              );
            })}
            {/* 「不套形态」必须是显式的一项：形态是帮人起步的，
                不给退出项就等于逼用户必须接受某一种预设的取舍。 */}
            <button
              type="button"
              data-shape=""
              aria-pressed={shapeId === ''}
              onClick={() => onShape(null)}
              className="w-[208px] rounded-md border border-dashed px-2.5 py-2 text-left transition-colors"
              style={{
                borderColor: shapeId === '' ? 'rgba(217,164,65,0.65)' : '#33413A',
                background: shapeId === '' ? 'rgba(217,164,65,0.09)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="mono text-[11px] leading-none text-fgFaint">⌫</span>
                <span className="text-[11px] font-medium leading-[16px] text-fg">从零开始</span>
              </div>
              <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                一个槽位都不预填，从空白台面自己拼 —— 适合已经有明确取舍的人。
              </p>
            </button>
          </div>
        </div>
      </div>
    </StepShell>
  );
}
