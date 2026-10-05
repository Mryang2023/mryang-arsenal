import { useMemo, useState } from 'react';

import { appendCharterToRuleSet, charterLintPreview, charterNotExecutableCount, type CharterViolation } from '@/lib/charter';
// 导入名与 `CheckConsole.tsx` 完全一致（`rules as allRules`）：同一个概念在两个文件里
// 用两个名字，就是等某天有人改了一处忘了另一处。
import { rules as allRules } from '@/lib/rules';
import { lint, type SourceFile } from '@/lib/engine';

/**
 * `/check` 的「项目模式」面板 —— 把章程条款并进本地正则层校验。
 *
 * 为什么是**本地**而不是走后端 `/api/lint`：后端引擎读的是 `arsenal-rules/`，
 * 它的规则池是构建期从磁盘加载的，**章程是另一个数据源**，后端此刻不认识它。
 * 而「项目模式」的价值恰恰是**提交前、不依赖任何服务**就能问一句
 * 「这段代码在本项目里合不合格」—— 那正是本地层能给的。
 *
 * 为什么不直接改 `allRules`：那是 L0 规则池，掺入项目条款会污染
 * 「全站 69 条」这个数字（它在导航、统计、导预算多处出现）。
 * 正确做法是**在派生层合并**，让 L0 与 L1 始终可分开数。
 *
 * 局限要说清（P1 范围内的诚实交代）：
 *   · 章程条款**只有 regex 层能在本地跑**。ast 层要后端 JDK 编译器，
 *     llm 层尚未启动。所以项目模式对「检测方式=ast/llm/manual」的条款
 *     **明确报「本机未执行」**，而不是静默跳过。
 *   · 全仓扫描（存量门）在 P2 才有 —— 这里只能查**你粘进来的这些文件**。
 */
export default function CharterCheckPanel({ files }: { files: SourceFile[] }) {
  const [enabled, setEnabled] = useState(true);

  const merged = useMemo(
    () => (enabled ? appendCharterToRuleSet(allRules) : allRules),
    [enabled],
  );

  const r = useMemo(() => {
    const has = files.some((f) => f.content.trim().length > 0);
    if (!has) return null;
    return lint(files, merged);
  }, [files, merged]);

  const charterHits = useMemo<CharterViolation[]>(
    () => (r ? charterLintPreview(r) : []),
    [r],
  );

  // 章程里**声明了但本机跑不了**的条款（ast / llm / manual）——
  // 它们的数量必须显示出来，否则「0 违规」会被读成「都查过了且没问题」。
  const notExecutable = useMemo(
    () => (enabled ? charterNotExecutableCount() : 0),
    [enabled],
  );

  if (!enabled) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={false} onChange={() => setEnabled(true)} />
          <span className="text-fg">项目模式：把本项目章程条款并入校验</span>
        </label>
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm text-fg">项目模式 · 本项目章程</h2>
        <label className="flex items-center gap-1.5 text-xs text-fgMuted">
          <input type="checkbox" checked onChange={() => setEnabled(false)} />
          关闭
        </label>
      </div>

      <p className="mt-1.5 text-xs text-fgMuted">
        规则池从 <span className="font-mono text-fg">{allRules.length}</span> 条扩到{' '}
        <span className="font-mono text-fg">{merged.length}</span> 条 —— 增加的是本项目章程条款
        （ID 以 <span className="font-mono">PJX-</span> 开头，与基线可分开数）。
      </p>

      {charterHits.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {charterHits.map((h, i) => (
            <li key={`${h.ruleId}-${h.line}-${i}`} className="text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[11px] text-fgFaint">{h.ruleId}</span>
                <span className="rounded bg-rust/15 px-1.5 py-0.5 text-[11px] text-rust">{h.severity}</span>
                <span className="text-fgMuted">{h.message}</span>
              </div>
              <div className="mt-0.5 pl-1 text-[11px] text-fgFaint">
                第 {h.line} 行 · 归谁管 {h.clauseOwner} · 依据 {h.decidedBy}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded border border-dashed border-line px-3 py-2.5 text-xs text-fgFaint">
          {files.some((f) => f.content.trim().length > 0)
            ? '章程条款在你的代码里没有命中。'
            : '粘点代码进来再算 —— 空输入不算「通过」。'}
        </p>
      )}

      {/*
        无论 notExecutable 是 0 还是 3，**这一条都要说**。
        第一版写成 `{notExecutable > 0 && …}`，于是「本仓 2 条条款全是正则层」时整条提示消失 ——
        而「没有要提示的」与「没有没跑的」在页面上长得一模一样。
        0 的情况要说「全部可机器判定」，因为它**也是一条结论**（这批条款质量高，不是没查）。
      */}
      <p
        className={[
          'mt-3 rounded border px-3 py-2 text-[11px] leading-relaxed',
          notExecutable > 0 ? 'border-brass/50 bg-brass/5 text-brass' : 'border-line bg-surfaceHi text-fgMuted',
        ].join(' ')}
      >
        {notExecutable > 0 ? (
          <>
            <b>本次有 {notExecutable} 条章程条款没跑</b>（检测方式是语法树 / 语义 / 人工）。
            静态导出站里没有编译器与模型，本机只能跑正则层。
            <b>「0 违规」不等于「都合规」</b> —— 那些条款要过后端深检（AST 层）或人工评审。
          </>
        ) : (
          <>
            本章程全部 {merged.filter((r) => r.id.startsWith('PJX-')).length} 条条款都是<b>正则层</b>
            可机器判定的，本次已在本地全部执行。
            <span className="ml-1 text-fgFaint">
              （若将来加了语法树/语义层的条款，这里会改成提示「有几条没跑」—— 那时「0 违规」就不能当成「都合规」读了。）
            </span>
          </>
        )}
      </p>

      <p className="mt-2.5 text-[11px] text-fgFaint">
        局限：这里只查你粘进来的文件。存量全仓扫描（PR 门 / 定时债务账）在 P2。
      </p>
    </section>
  );
}
