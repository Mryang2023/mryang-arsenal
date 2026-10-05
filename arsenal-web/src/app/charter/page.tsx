import type { Metadata } from 'next';

/**
 * `/charter` 的迁移页（2026-10-05）。
 *
 * 原来这里是一整页「项目章程」。用户要的是「多人开发同一个项目时的**工程规范管理**」——
 * 而那一页的三个页签都以**条款**为中心，是「审章程」的视角。于是整页重定位为
 * `/standards` 工程规范台：上面加一层治理台（待办 / 责任人 / 模块风险 / 时间线 / 门禁就绪度），
 * **原来的全部内容作为「明细」内嵌在下面，一处没删**。
 *
 * 为什么留这一页而不是直接 301：
 *   · 本仓是**静态导出**（`output: 'export'`），next.config 里的 redirects
 *     在导出模式下不生成任何东西 —— 声称「已重定向」而实际没有，是本仓最烦的那类假动作；
 *   · 书签、旧链接、外部文档可能还指着这个路径。
 * 所以这里是一张**会自己跳**的迁移页：`<meta http-equiv="refresh">` 真的跳，
 * 同时给一个手动链接（自动跳转被浏览器/阅读器拦掉时还能点）。
 */
export const metadata: Metadata = {
  title: '已迁移 · 工程规范台',
  robots: { index: false, follow: false },
};

export default function CharterMovedPage() {
  return (
    <main className="flex-1 px-5 py-8 md:px-8">
      <meta httpEquiv="refresh" content="0; url=/standards/" />
      <h1 className="text-xl font-medium text-fg">这一页已并入「工程规范台」</h1>
      <p className="mt-3 max-w-2xl text-sm text-fgMuted">
        原来的「项目章程」页是<b>审章程</b>的视角 —— 有什么规矩、谁在破例、哪条规矩在持续吃豁免。
        工程规范管理要回答的是另一个问题：<b>多人一起写代码时，现在该谁管什么、哪里在破、什么时候该收口</b>。
        所以整页换成了「治理台 + 明细」两层结构，<b>明细部分就是原来这一页，一处没删</b>。
      </p>
      <p className="mt-4">
        <a href="/standards/" className="text-sm text-brass underline">
          去工程规范台 →
        </a>
      </p>
      <p className="mt-6 text-xs text-fgFaint">
        本仓是静态导出，配置文件里的 redirects 在导出模式下不生成任何东西 ——
        与其声称「已重定向」而实际没跳，不如给一张真的会跳的页子。
      </p>
    </main>
  );
}
