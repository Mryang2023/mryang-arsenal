/**
 * 生图原图 → `public/icons/<分类>/<key>.png`（512×512）。
 *
 * ── 为什么必须有这一步 ──
 *
 * 生图产出的是 1024×1024、单张 ~200KB。图标库的体积闸门是**全库 ≤6MB**
 * （`sync-content.mjs` ⑥），81 张原图约 16MB，直接超限、同步当场中断。
 * 缩到 512 之后单张 ~47KB，全量 81 张约 3.8MB，能进仓库。
 *
 * ── 配对规则 ──
 *
 * 生图工具按 prompt 生成文件名（前 ~30 字符）。所以**prompt 必须以 key 开头**
 * （`user icon, flat vector, …`），文件名就成了 `user_icon__flat_vector_…png`，
 * 配对靠这个前缀。配不上的文件会**列出来并以非零码退出** —— 静默跳过一张图的
 * 后果是「以为生成了 18 张、实际只有 17 张」，而且没有任何迹象。
 *
 * ── 为什么不引图形库 ──
 *
 * sharp / canvas / jimp 都是新依赖，这个仓库对「零外部依赖」有承诺。
 * 无头 Chrome 的 canvas 缩放 + 元素截图，用已有的 playwright-core 就够，
 * 而且是浏览器级的重采样质量。
 *
 * 用法：
 *   node scripts/icons-rasterize.mjs <生图原图目录> [--size 512]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME = process.env.ARSENAL_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const argv = process.argv.slice(2);
// 位置参数 = 第一个既不是 --flag、也不是 --size 的值的那个。
// （早先写成 argv[sizeFlag+1] 的排除法，sizeFlag 为 -1 时恰好把 rawDir 自己也排除掉，
//   于是「不给 --size」就永远报「用法」错 —— 参数解析要按索引排除，不能按值。）
const sizeFlag = argv.indexOf('--size');
const SIZE = sizeFlag >= 0 ? Number(argv[sizeFlag + 1]) || 512 : 512;
const consumed = new Set();
if (sizeFlag >= 0) {
  consumed.add(sizeFlag);
  consumed.add(sizeFlag + 1);
}
const rawDir = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i));

if (!rawDir) {
  console.error('用法：node scripts/icons-rasterize.mjs <生图原图目录> [--size 512]');
  process.exit(2);
}

const webRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(webRoot, '..');
const iconsDoc = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'arsenal-icons', 'icons.json'), 'utf8')
);
const categoryOf = new Map((iconsDoc.icons ?? []).map((i) => [i.key, i.category]));

const raws = fs
  .readdirSync(path.resolve(webRoot, rawDir))
  .filter((f) => f.toLowerCase().endsWith('.png'));
if (!raws.length) {
  console.error(`${rawDir} 里没有 PNG`);
  process.exit(2);
}

// 文件名首段 = key（prompt 以 key 开头）
const pairs = [];
const unmatched = [];
for (const f of raws) {
  const key = f.split('_')[0];
  const category = categoryOf.get(key);
  if (!category) {
    unmatched.push(f);
    continue;
  }
  pairs.push({ src: path.join(rawDir, f), key, category, dest: `public/icons/${category}/${key}.png` });
}

if (unmatched.length) {
  console.error(
    `这些原图配不上任何 icon key（文件名首段必须是 key）：\n  - ${unmatched.join('\n  - ')}\n` +
      `生图 prompt 记得以「<key> icon」开头，否则文件名里带不出 key。`
  );
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });

let bytes = 0;
for (const p of pairs) {
  const b64 = fs.readFileSync(path.resolve(webRoot, p.src)).toString('base64');
  await page.setContent(
    `<html><body style="margin:0;padding:0;background:#fff">` +
      `<img id="i" alt="" src="data:image/png;base64,${b64}" ` +
      `style="display:block;width:${SIZE}px;height:${SIZE}px"></body></html>`
  );
  await page.waitForFunction(() => {
    const el = document.getElementById('i');
    return el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0;
  });
  const dest = path.join(webRoot, p.dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await (await page.$('#i')).screenshot({ path: dest });
  const n = fs.statSync(dest).size;
  bytes += n;
  console.log(`  ${p.dest}  ${(n / 1024).toFixed(1)}KB`);
}
await browser.close();

const total = fs
  .readdirSync(path.join(webRoot, 'public', 'icons'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .reduce((n, e) => n + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);

console.log(
  `\n落位 ${pairs.length} 张，本批 ${(bytes / 1024).toFixed(0)}KB；` +
    `public/icons 现共 ${(total / 1024).toFixed(0)}KB（闸门 6MB）\n` +
    `下一步：在 tools/content/icons.py 的 BITMAPS 表里登记 key → 路径，` +
    `再跑 build-content.py 与 sync-content.mjs。`
);
