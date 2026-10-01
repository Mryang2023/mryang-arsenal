import type { Config } from 'tailwindcss';
import { TONE } from './src/app/stack/palette';

/**
 * 军火库配色：深色军事工业风。
 * 底色近墨，主强调用「黄铜」与「军绿」——库房与弹药的质感。
 *
 * ⚠️ 三个强调色**不在这里写字面量**：`brass` / `olive` / `rust` 一律从
 * `src/app/stack/palette.ts` 的 TONE 取（2026-10-01 收编）。此前这里是第二份
 * 色值，与 palette 各写一遍 —— 装配台组件里于是出现了 `rose-400` 这种
 * tailwind 出厂红，页面上同时存在两套「坏」的红色，改主色时只有一套跟着变。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0B0F0E',
        surface: '#131917',
        surfaceHi: '#1A2220',
        surfaceMax: '#212B28',
        line: '#243029',
        lineHi: '#33413A',
        /** 结构图的连接线。比 lineHi 再亮一档：线太淡时整棵树会退化成
         *  「一堆缩进的文字」，层级关系就看不出来了。 */
        treeLine: '#3C4D45',
        fg: '#E8F0EC',
        fgMuted: '#93A39C',
        /** 最淡一档的正文/说明文字。2026-09-23 由 #5E6E67 提亮：
         *  原值在 surface 上 3.31:1、surfaceHi 上 3.02:1，低于 WCAG AA 正文 4.5:1；
         *  现值 4.90~5.65:1（三个背景全过），仍比 fgMuted 的 6.15:1 淡一档。
         *  判据与实测见 arsenal-web/visual/assert.mjs 的 A5 断言。 */
        fgFaint: '#80918A',
        brass: TONE.warn.color,
        brassDim: '#8A6A2A',
        olive: TONE.ok.color,
        /** 「坏」的那档红，与 TONE.bad 同源（预检闸拦截、出图失败、结构自检报错）。
         *  以前这些地方直接用 tailwind 的 `rose-*`，等于引入了第二套红。 */
        rust: TONE.bad.color,
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Microsoft YaHei"',
          '"PingFang SC"', '"Hiragino Sans GB"', 'Roboto', 'sans-serif',
        ],
        mono: [
          '"Cascadia Code"', '"JetBrains Mono"', 'Consolas', '"Courier New"',
          'ui-monospace', 'monospace',
        ],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.8)',
        lift: '0 12px 32px -16px rgba(0,0,0,0.9)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22,1,0.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
