'use client';

import { useCallback } from 'react';

import { buildCharterCI, buildCharterMarkdown, charterDeliverableFiles } from '@/lib/charter';
import type { CharterDoc } from '@/lib/charter';

/**
 * 导出区：三个出口各一个下载按钮。
 *
 * 为什么放在 `/charter` 页而不是 `/export`：那边是**规则集**的导出中心（有筛选器、
 * 六个载体），章程是另一个数据源、另一套字段。硬塞进去会让那个页面的筛选器
 * 「对章程条款无效但看不出无效」—— 那是本仓最讨厌的一类假控件。
 *
 * 三个文件的用途：
 *   CHARTER.md  → 人读（新人上手、方案评审、半年后回查「当初为什么这么定」）
 *   charter-gate.yml → CI（PR 门 + 存量债扫描）
 *   arsenal-charter.json → 归档（导出的那一刻的快照，带日期）
 */
export default function CharterExport({ doc }: { doc: CharterDoc }) {
  const save = useCallback((filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 不 revoke 就立刻下载的话，部分浏览器会拿到空文件 —— 与 `export` 页同一处教训。
    URL.revokeObjectURL(url);
  }, []);

  const files = charterDeliverableFiles(doc);

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">导出</h2>
      <p className="mt-1 text-xs text-fgMuted">
        三个出口各一份。规范书给人读，CI 片段给机器跑，JSON 是带日期的归档快照。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => save('CHARTER.md', buildCharterMarkdown(doc), 'text/markdown')}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg hover:bg-surfaceHi"
        >
          ↓ 规范书 CHARTER.md
          <span className="ml-1.5 text-fgFaint">{buildCharterMarkdown(doc).length} 字符</span>
        </button>
        <button
          onClick={() => save('charter-gate.yml', buildCharterCI({ projectName: doc.name }), 'text/yaml')}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg hover:bg-surfaceHi"
        >
          ↓ CI 片段 charter-gate.yml
          <span className="ml-1.5 text-fgFaint">PR 门 + 存量账</span>
        </button>
        <button
          onClick={() => save('arsenal-charter.json', files[0]?.content ?? '{}', 'application/json')}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-fg hover:bg-surfaceHi"
        >
          ↓ 归档 arsenal-charter.json
          <span className="ml-1.5 text-fgFaint">带日期的快照</span>
        </button>
      </div>
      <p className="mt-2 text-[11px] text-fgFaint">
        CI 片段里的判负口径**不写死** —— 例外到期判不判负读你章程的
        <code className="text-fgMuted">policy</code> 段，改那里即可，不必改这个 yml。
      </p>
    </section>
  );
}
