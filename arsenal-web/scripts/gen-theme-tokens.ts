/**
 * 生成 Tailwind 4 主题 token（src/generated/theme-tokens.css）。
 *
 * 为什么要有它：Tailwind 4 走 CSS-first 的 `@theme`，而配色单一来源在
 * `src/app/stack/palette.ts` 的 TONE（brass/olive/rust 三色与 bad/warn/ok 同源）。
 * CSS 没法 import TS —— 所以由这份生成器把「中性色字面量 + TONE 三色」合成一份
 * CSS token 文件，globals.css `@import` 它。tailwind.config.ts 自此退役。
 *
 * 一份数据：palette.ts 是唯一色源 → 本生成器产出 CSS → 页面 utilities。
 * 防漂移：`--check` 模式重算一遍与磁盘比对，不一致即退出 1
 * （与 gen-rule-schema.mjs --check 同一口径；sync 链每次都重新生成，
 *  check 留给 CI / 手工核对）。
 *
 * 产物在 src/generated/（gitignore，与 roster/charter 等生成物同一待遇）：
 * 不要手改，不要提交。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TONE } from '../src/app/stack/palette';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'generated', 'theme-tokens.css');

const css = `/* ⚠️ 生成物：scripts/gen-theme-tokens.ts 产出，勿手改勿提交。
   色源唯一：中性色是 tailwind.config.ts 时代的字面量（迁入此处），
   brass / olive / rust 三色取自 src/app/stack/palette.ts 的 TONE。 */
@theme {
  /* ── 中性色：深色军事工业风的五档底与三级字 ── */
  --color-canvas: #0B0F0E;
  --color-surface: #131917;
  --color-surfaceHi: #1A2220;
  --color-surfaceMax: #212B28;
  --color-line: #243029;
  --color-lineHi: #33413A;
  /* 结构图连接线。比 lineHi 再亮一档：线太淡时整棵树会退化成
     「一堆缩进的文字」，层级关系就看不出来了。 */
  --color-treeLine: #3C4D45;
  --color-fg: #E8F0EC;
  --color-fgMuted: #93A39C;
  /* 最淡一档的正文/说明文字。2026-09-23 由 #5E6E67 提亮：
     原值在 surface 上 3.31:1、surfaceHi 上 3.02:1，低于 WCAG AA 正文 4.5:1；
     现值 4.90~5.65:1（三个背景全过），仍比 fgMuted 的 6.15:1 淡一档。
     判据与实测见 arsenal-web/visual/assert.mjs 的 A5 断言。 */
  --color-fgFaint: #80918A;

  /* ── 语义三色：与 TONE 同源（坏 / 警 / 好），页面里不许再分叉 ── */
  --color-brass: ${TONE.warn.color};
  --color-brassDim: #8A6A2A;
  --color-olive: ${TONE.ok.color};
  --color-rust: ${TONE.bad.color};

  /* ── 字体 / 字号 ── */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei",
    "PingFang SC", "Hiragino Sans GB", Roboto, sans-serif;
  --font-mono: "Cascadia Code", "JetBrains Mono", Consolas, "Courier New",
    ui-monospace, monospace;
  --text-2xs: 11px;
  --text-2xs--line-height: 16px;

  /* ── 阴影 / 动效 ── */
  --shadow-panel: 0 1px 0 0 rgba(255, 255, 255, 0.03) inset,
    0 8px 24px -12px rgba(0, 0, 0, 0.8);
  --shadow-lift: 0 12px 32px -16px rgba(0, 0, 0, 0.9);
  --animate-fade-up: fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;

  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
`;

function main() {
  const check = process.argv.includes('--check');
  if (check) {
    if (!existsSync(outPath)) {
      console.error('[theme-tokens] 未找到生成物，先跑 npm run sync 或 gen:theme-tokens。');
      process.exit(1);
    }
    const onDisk = readFileSync(outPath, 'utf8');
    if (onDisk !== css) {
      console.error('[theme-tokens] 漂移：磁盘上的 theme-tokens.css 与 palette.ts 现算不一致。');
      console.error('  → 重跑 npm run gen:theme-tokens 并提交差异。');
      process.exit(1);
    }
    console.log('[theme-tokens] check 通过：palette.ts 与 theme-tokens.css 一致。');
    return;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, css);
  console.log(`[theme-tokens] 已生成 ${outPath}`);
}

main();
