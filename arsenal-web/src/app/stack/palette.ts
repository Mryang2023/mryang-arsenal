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
