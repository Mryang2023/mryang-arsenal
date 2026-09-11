import type { Config } from 'tailwindcss';

/**
 * 军火库配色：深色军事工业风。
 * 底色近墨，主强调用「黄铜」与「军绿」——库房与弹药的质感。
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
        fgFaint: '#5E6E67',
        brass: '#D9A441',
        brassDim: '#8A6A2A',
        olive: '#7FA650',
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
