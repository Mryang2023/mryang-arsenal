import type { Metadata } from 'next';

/**
 * `/arch` 的迁移页（2026-10-17 超级夜 · 架构图谱合并棒3）。
 *
 * 原来这里是一整页「架构图谱」（六视图画廊 + 可拖拽技术画布 + 档案选择器）。
 * 架构图谱合并（`docs/开发计划-2026-10-16-架构图谱合并进项目侦察/00-计划书.md`）
 * 把六视图与画布整体并进了「项目侦察」（`/autopsy`）的架构面板：
 *   · 技术架构画布 → 架构面板「技术架构」子页签（picks 跟扫描走，副本数只从部署清单读）；
 *   · 六张静态图 → 「六视图」子页签（内置档案 / 扫描草稿 / 导入档案三选一）；
 *   · 「从代码生成」的扫描入口只留 `/autopsy` 一处（原来两页各一个，是漂移温床）。
 *
 * 为什么留这一页而不是直接 301（与 /charter → /standards 同一条理由）：
 *   · 本仓是**静态导出**（`output: 'export'`），next.config 里的 redirects
 *     在导出模式下不生成任何东西 —— 声称「已重定向」而实际没有，是本仓最烦的那类假动作；
 *   · 书签、旧链接、外部文档可能还指着这个路径。
 * 所以这里是一张**会自己跳**的迁移页：`<meta http-equiv="refresh">` 真的跳，
 * 同时给一个手动链接（自动跳转被浏览器/阅读器拦掉时还能点）。
 *
 * 想恢复画廊：把这一页改回画廊即可 —— 六视图渲染器（`app/autopsy/diagrams.tsx`）
 * 是共享组件，不绑死路由；但两个 URL 长期讲同一套六视图就是漂移温床，
 * 所以合并时选的是「一个入口」（计划书 §5 拍板项 1 · A 方案）。
 */
export const metadata: Metadata = {
  title: '已迁移 · 项目侦察',
  robots: { index: false, follow: false },
};

export default function ArchMovedPage() {
  return (
    <main className="flex-1 px-5 py-8 md:px-8">
      <meta httpEquiv="refresh" content="0; url=/autopsy/" />
      <h1 className="text-xl font-medium text-fg">这一页已并入「项目侦察」</h1>
      <p className="mt-3 max-w-2xl text-sm text-fgMuted">
        原来的「架构图谱」页是<b>单独看六张图</b>的视角 —— 业务 / 数据 / 应用 / 技术 / 产品 / 项目，
        讲的是某个项目的六面。项目侦察要回答的是另一个问题：<b>给一个地址，一次扫描出全套项目画像</b>
        —— 技术栈部署图、应用分层图、六视图档案、未识别依赖清单，全部从同一份扫描事实来。
      </p>
      <p className="mt-3 max-w-2xl text-sm text-fgMuted">
        所以六视图与可拖拽画布<b>整体搬进了侦察的架构面板</b>，一处没删：
        画布在「技术架构」子页签（跟着本次扫描的选型走），六张静态图在「六视图」子页签
        （内置档案 / 本次扫描草稿 / 导入档案三选一）。扫描入口也收敛成一处 ——
        原来两页各有一个，讲同一批事实的两个入口就是漂移温床。
      </p>
      <p className="mt-4">
        <a href="/autopsy/" className="text-sm text-brass underline">
          去项目侦察 →
        </a>
      </p>
      <p className="mt-6 text-xs text-fgFaint">
        本仓是静态导出，配置文件里的 redirects 在导出模式下不生成任何东西 ——
        与其声称「已重定向」而实际没跳，不如给一张真的会跳的页子。
      </p>
      <p className="mt-2 max-w-2xl text-xs text-fgFaint">
        想恢复原来的画廊：把这一页改回画廊页即可（六视图渲染器与档案机制都是共享组件，不绑死路由）——
        但两个网址长期讲同一套六视图，内容迟早各改各的；所以合并时选的是「一个入口」，恢复成本由你承担。
      </p>
    </main>
  );
}
