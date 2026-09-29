/**
 * 把 arsenal-scaffold/** 打进前端可用的 bundle（静态导出离线优先，生成在前端算）。
 *
 * 产物 src/generated/scaffold-templates.ts：
 *   - SCAFFOLD_FILES  相对路径（含 .tpl）→ 模板全文
 *   - SCAFFOLD_MODULES 模块 id → module.json 清单
 *
 * 路径里保留 {{basePackagePath}} 等占位段 —— 渲染器（lib/scaffold/render.ts）
 * 会对路径字符串本身做同样的白名单替换，这里不做任何变换。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = path.join(root, '..', 'arsenal-scaffold');
const OUT = path.join(root, 'src', 'generated', 'scaffold-templates.ts');

const files = {};
const modules = {};

function walk(dir, rel = '') {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const key = rel ? `${rel}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      walk(full, key);
      continue;
    }
    if (name === 'module.json') {
      const owner = key.match(/modules\/([^/]+)\/module\.json/);
      if (owner) modules[owner[1]] = JSON.parse(fs.readFileSync(full, 'utf8'));
      continue;
    }
    files[key] = fs.readFileSync(full, 'utf8');
  }
}

if (!fs.existsSync(SRC)) {
  console.error('scaffold 目录不存在:', SRC);
  process.exit(1);
}
walk(SRC);

const banner = `/* eslint-disable */
// 本文件由 scripts/build-scaffold-templates.mjs 生成 —— 勿手改，改 arsenal-scaffold/ 后重跑。
// 模板全文按原路径收录，渲染与占位符规则见 src/lib/scaffold/render.ts。

export const SCAFFOLD_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};

export const SCAFFOLD_MODULES: Record<string, unknown> = ${JSON.stringify(modules, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner, 'utf8');
console.log(
  `[scaffold] ${Object.keys(files).length} 份模板 / ${Object.keys(modules).length} 个模块清单 → src/generated/scaffold-templates.ts`,
);
