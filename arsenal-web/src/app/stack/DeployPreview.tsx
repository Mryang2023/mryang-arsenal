'use client';

import { useMemo } from 'react';
import type { DeployFile } from '@/lib/deploy';
import { INK, TONE } from './palette';

/**
 * ⑧ 交付与运行的**右栏预览**：这套选型会生成哪些部署文件。
 *
 * 为什么要在这一步就看得到：⑧ 问的是「跑在什么环境、谁编排、怎么构建发布」，
 * 而它的**后果**（生成 Dockerfile / compose / K8s 清单 / Helm chart / CI 流水线）
 * 原本只在 ⑩ 交付中心的 deploy 页签里 —— 选完了不知道自己选出了什么，
 * 直到导出那一刻才看见。现在左边表态、右边这份清单同帧变。
 *
 * ⚠️ 清单里的文件是**真去生成一遍**得到的（调用方传 `buildDeployPlan()` 的结果），
 * 不是「按选型猜有哪些」—— 猜出来的清单会和导出包对不上，那比没有更糟。
 * 一份都没生成就是这套选型还没有部署产物，如实说，不摆一排占位卡片。
 */
export default function DeployPreview({ files }: { files: DeployFile[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, DeployFile[]>();
    for (const f of files) {
      const top = f.path.includes('/') ? `${f.path.split('/')[0]}/` : '项目根';
      const list = m.get(top) ?? [];
      list.push(f);
      m.set(top, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files]);

  return (
    <section className="panel overflow-hidden" data-deploy-preview="">
      <header className="border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-x-2.5">
          <span className="mono text-[12px] leading-none text-brass">⎋</span>
          <h3 className="text-[12px] font-semibold leading-[18px] text-fg">会生成哪些部署文件</h3>
          <span className="mono ml-auto text-[10px] leading-[15px] text-fgFaint">
            {files.length} 个
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
          左边每表一次态，这份清单同帧变 —— 它就是 ⑩ 交付中心 deploy 页签里那份，
          不是另算一份。
        </p>
      </header>

      {files.length === 0 ? (
        <div className="px-4 py-3" data-deploy-preview-empty="">
          <p className="text-[10px] leading-[15px] text-fgMuted">
            当前选型没有任何部署产物 —— 先在左边表态「部署形态 / 编排方式 / 交付形态」，
            这里就会列出对应的 Dockerfile、compose、K8s 清单或 Helm chart。
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map(([top, list]) => (
            <div key={top} className="px-4 py-2.5">
              <p className="mono text-[10px] leading-[15px]" style={{ color: TONE.warn.color }}>
                {top}
              </p>
              <ul className="mt-1 space-y-0.5">
                {list.map((f) => (
                  <li
                    key={f.path}
                    className="flex flex-wrap items-baseline gap-x-2 text-[10px] leading-[15px]"
                    data-deploy-file={f.path}
                  >
                    <code className="min-w-0 flex-1 truncate text-fgMuted">{f.path}</code>
                    {f.from && <span className="mono text-fgFaint">{f.from}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="px-4 py-2.5">
            <p className="text-[10px] leading-[15px] text-fgFaint">
              这些文件随导出包一起带走 —— 想看全文去{' '}
              <span className="mono" style={{ color: INK.muted }}>
                ⑩ 交付中心 · deploy 页签
              </span>
              。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
