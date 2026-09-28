'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * ④ 分层装配的右侧选件抽屉（09-28 四次反馈：左台面 + 右栏两栏排版不好，
 * 改成台面全宽铺开、点槽位才从右缘浮出选件面板，不占版面）。
 *
 * 三个决定：
 * - **无遮罩**：台面保持可见可点 —— 点另一个方块就是直接换抽屉内容，
 *   点遮罩关闭反而多一步；视觉上靠左缘硬边框 + 大阴影表达「浮在上面」。
 * - **z-30**：低于槽位就地换件菜单（z-40，它是当前操作的临时浮层，永远最上）、
 *   低于放大查看（z-60）；高于普通内容。
 * - **portal 到 body**：不吃台面的 overflow 裁剪。只在 activeDim 非空时挂载，
 *   静态导出（SSG）首渲染不会碰 document。
 *
 * 关闭三路：Picker 头部 × / Esc（StackComposer 现有分层链：换件菜单 >
 * 草稿面板 > 选件面板）/ 换选其他方块（内容替换，不是关闭）。
 * 壳本身不渲染关闭钮 —— 头部在内容体（Picker）手里，壳只负责浮层形状。
 */
export default function DimDrawer({ children }: { children: ReactNode }) {
  return createPortal(
    <aside
      data-dim-drawer=""
      className="fixed inset-y-0 right-0 z-30 flex w-[min(460px,94vw)] flex-col border-l border-line bg-surface"
      style={{ boxShadow: '-28px 0 56px rgba(0,0,0,0.5)' }}
    >
      {children}
    </aside>,
    document.body
  );
}
