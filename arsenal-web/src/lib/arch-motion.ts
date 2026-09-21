/**
 * SVG 内嵌动效 —— 一段 CSS，随图走。
 *
 * 为什么用 `<style>` 而不是 SMIL（`<animate>`）：
 *   ① SMIL 在 Chrome 里被标记过「考虑移除」，CSS 动画是长稳方案；
 *   ② 内嵌 CSS 在**独立打开的 .svg 文件里照样生效** —— 这点是刚需，
 *      因为技术架构图要能导出成 SVG 发给别人，对方双击打开就该看到活的图；
 *   ③ 一份 CSS 能同时给「页面内联 SVG」和「导出文件」用，不用写两套。
 *
 * 三条克制：
 *   · 只做「看得出在动、但不抢内容」的量级 —— 流光 1.2s 一轮，入场 60ms 一档；
 *   · 尊重 prefers-reduced-motion，系统开了减弱动效就全部停掉；
 *   · 动画只改 opacity / transform / stroke-dashoffset 这类合成友好的属性，
 *     不改布局，所以静态截图（PNG 导出、PDF 打印）落在第一帧也好看。
 */

/** 注入到 SVG `<defs>` 里的样式表。class 一律 am- 前缀，避免和宿主页面撞名。 */
export function svgMotionStyle(extra = ''): string {
  return (
    `<style>` +
    `.am-flow{stroke-dasharray:6 7;animation:am-dash 1.1s linear infinite}` +
    `.am-flow-slow{stroke-dasharray:4 8;animation:am-dash 2.4s linear infinite}` +
    /* 跑动光带：叠在**实线**上沿路径滑一段高亮，线本身仍是实线。
       为什么不直接给实线加 dasharray —— 实线在这张图里是"调用 / 数据流"的语义，
       把它变成虚线等于把语义改成了"异步"，是错误的信息，不是装饰。 */
    `.am-run{animation:am-run 2.8s linear infinite}` +
    `.am-rise{animation:am-rise .42s cubic-bezier(.22,.8,.3,1) both;animation-delay:calc(var(--i,0)*55ms)}` +
    `.am-breathe{animation:am-breathe 2.6s ease-in-out infinite}` +
    `.am-pulse{transform-box:fill-box;transform-origin:center;animation:am-pulse 2.2s ease-out infinite}` +
    `.am-spin{transform-box:fill-box;transform-origin:center;animation:am-spin 9s linear infinite}` +
    `.am-glow{animation:am-glow 3.4s ease-in-out infinite}` +
    `@keyframes am-dash{to{stroke-dashoffset:-26}}` +
    `@keyframes am-run{from{stroke-dashoffset:236}to{stroke-dashoffset:0}}` +
    `@keyframes am-rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}` +
    `@keyframes am-breathe{0%,100%{opacity:.45}50%{opacity:1}}` +
    `@keyframes am-pulse{0%{transform:scale(.6);opacity:.55}70%{transform:scale(1.9);opacity:0}100%{transform:scale(1.9);opacity:0}}` +
    `@keyframes am-spin{to{transform:rotate(360deg)}}` +
    `@keyframes am-glow{0%,100%{opacity:.35}50%{opacity:.85}}` +
    extra +
    `@media (prefers-reduced-motion:reduce){` +
    `.am-flow,.am-flow-slow,.am-run,.am-rise,.am-breathe,.am-pulse,.am-spin,.am-glow{animation:none}` +
    `.am-rise{opacity:1}` +
    `.am-run{opacity:0}` +
    `}` +
    `</style>`
  );
}

/** 给元素挂入场动画，`i` 是档位（同排元素递增，形成左→右依次浮现） */
export function amRise(i: number): string {
  return ` class="am-rise" style="--i:${i}"`;
}

/** 连线流光：`fast` 给同步调用，`slow` 给异步/配置注入这类"不常走"的边 */
export function amFlow(speed: 'fast' | 'slow' = 'fast'): string {
  return ` class="am-${speed === 'fast' ? 'flow' : 'flow-slow'}"`;
}

/** 脉冲环：套在一个 circle 上，做出"有东西在往外发"的感觉 */
export function amPulse(): string {
  return ` class="am-pulse"`;
}

/** 呼吸：给状态点、副本角标这类小元素 */
export function amBreathe(): string {
  return ` class="am-breathe"`;
}

export function amSpin(): string {
  return ` class="am-spin"`;
}

export function amGlow(): string {
  return ` class="am-glow"`;
}
