/**
 * 架构画布的语义色。
 *
 * 三档结论各有固定颜色，含义在整个页面里不允许复用成别的意思：
 *   bad  跑不起来      warn 能跑但有隐患      ok 通过
 * 空白槽位一律用灰，避免和「错误」混淆 —— 可选件留空是正常状态，不是问题。
 */
export interface Tone {
  color: string;
  soft: string;
  border: string;
}

export const TONE: Record<'bad' | 'warn' | 'ok' | 'idle' | 'info', Tone> = {
  bad: { color: '#E5484D', soft: 'rgba(229,72,77,0.10)', border: 'rgba(229,72,77,0.55)' },
  warn: { color: '#D9A441', soft: 'rgba(217,164,65,0.10)', border: 'rgba(217,164,65,0.55)' },
  ok: { color: '#7FA650', soft: 'rgba(127,166,80,0.10)', border: 'rgba(127,166,80,0.55)' },
  idle: { color: '#5E6E67', soft: 'rgba(255,255,255,0.015)', border: '#33413A' },
  info: { color: '#6E8FA8', soft: 'rgba(110,143,168,0.10)', border: 'rgba(110,143,168,0.5)' },
};

export type ToneKey = keyof typeof TONE;

/**
 * 非语义的「描边 / 次要字 / 正文」色。
 *
 * 为什么连灰的也要登记：装配台一度在十来个组件里裸写 `#243029` / `#93A39C`，
 * 改主题时只能靠 grep 撞运气 —— 漏一处就是「这一块的边框比别处深一点」，
 * 说不清是设计还是 bug。现在**装配台里不许出现裸的十六进制色**：
 * 语义色走 TONE、中性色走 INK、分类色走 SWATCH。
 */
export const INK = {
  /** 常规描边（未选中卡片、分隔块底） */
  line: '#243029',
  /** 更淡一档的描边（复选框、点） */
  dim: '#33413A',
  /** 次要文字 */
  muted: '#93A39C',
  /** 正文（比 fg 弱一档的长段落） */
  body: '#C8D6D0',
  /** 主文字 */
  fg: '#E8F0EC',
  /** 最浅一档文字（图上标签、次要刻度） */
  pale: '#CFDCD6',
  /** 画布底（SVG 图形压在它上面，比页面 canvas 更深） */
  deep: '#0A0F0E',
  /** 连线（画布内的边，与页面描边 line 不是一回事） */
  edge: '#5C7C78',
} as const;

/**
 * 分类色板 —— 只用于「按类别区分」的场合（目录树徽章的构建工具 / 迁移工具分色），
 * **不表达好坏**。判断好坏一律用 TONE，别拿紫色当「警告」。
 *
 * ⚠️ 徽章配色一度直接借 TONE.warn / TONE.ok 的颜色值（黄=缓存、绿=鉴权），
 * 结果是「鉴权」徽章绿得跟「校验通过」一个意思 —— 看着像评价，其实只是分类。
 * 现在分类一律走这里，色值可以同，语义不许混。
 */
export const SWATCH = {
  /** 无类别 / 全部 / 可选 */
  neutral: { color: '#5E6E67', soft: 'rgba(94,110,103,0.12)' },
  /** 外部工具与注册中心（Maven / Gradle / Nacos / Prometheus / SpringDoc） */
  tool: { color: '#6E8FA8', soft: 'rgba(110,143,168,0.12)' },
  /** 数据访问（MyBatis-Plus / JPA / Druid） */
  build: { color: '#5FA8A0', soft: 'rgba(95,168,160,0.12)' },
  /** 迁移（Flyway / Liquibase） */
  migration: { color: '#8A7FD0', soft: 'rgba(138,127,208,0.12)' },
  /** 缓存与调度（Redis / Caffeine / XXL-Job / 定时任务 / 启动类） */
  cache: { color: '#D9A441', soft: 'rgba(217,164,65,0.12)' },
  /** 鉴权与测试（Spring Security / Sa-Token / Testcontainers） */
  auth: { color: '#7FA650', soft: 'rgba(127,166,80,0.12)' },
} as const;

/** 白色高光（选中底、徽标底）—— 只在深色画布上用，别拿它当「浅色模式」 */
export function gloss(alpha: number): string {
  return `rgba(255,255,255,${alpha})`;
}

/** 从 TONE 的 hex 里拆 rgb —— 不在别处再记一份色值，避免两处分叉 */
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * 半透明取色：`toneAt('warn', 0.6)`。
 *
 * 之所以要这个 helper：组件里原来手拼 `rgba(217,164,65,0.6)`，色值在几处各写一遍，
 * 调主色时这些半透明副本不会跟着变（而且 grep `#D9A441` 根本搜不到它们）。
 * alpha=1 时原样返回 hex（SVG 的 stroke / fill 要的是实心值）。
 *
 * ⚠️ 名字为什么带 At：装配台里 `tone` 是个高频局部变量（`const tone = TONE[...]`），
 * 导名叫 `tone` 会被组件内的同名常量遮蔽，调用时炸「tone is not a function」。
 */
export function toneAt(key: ToneKey, alpha = 1): string {
  if (alpha >= 1) return TONE[key].color;
  const [r, g, b] = rgbOf(TONE[key].color);
  return `rgba(${r},${g},${b},${alpha})`;
}
