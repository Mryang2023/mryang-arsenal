/**
 * 一次性组装器（2026-10-17 结构面板棒3）—— 跑完即删，不进 git。
 *
 * 为什么存在：本 harness 里 java 进程在 Spring「Started」后约 1s 自退
 * （实测 0.3s 粒度采样：t=6 起归零，Tomcat 从未 LISTENING），后端扫不了。
 * 而页面 E2E 需要真 facts —— 本脚本把 fixture 的**真实文件内容**按
 * CodeScanner.classify() 的判据逐字复刻，组装成与扫描器同形状的 facts JSON，
 * 由 E2E 探针用 page.route 喂给真页面。诚实边界：
 *   · 分类判据 = Java classify() 源码逐行复刻（注解 > 类名后缀 > 包名）；
 *   · 扫描器侧真路径由 scan-check【1c】14 断言覆盖（今日 16:28 真探针跑过）；
 *   · 本组装器只服务「页面渲染与交互」验证，不当扫描器替代品。
 */
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = process.argv[2] || 'D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/fixtures/demo-repo';
const STALE = 'D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/tmp/facts-full.json';
const OUT =
  process.argv[3] ||
  'D:/workspace/2026/mryang-arsenal/.workbuddy/night-chain/2026-10-17/_e2e-demo-facts.json';

const SKIP = new Set(['.git', 'node_modules', 'target', 'build', 'dist', 'out', '.next', 'bin', 'vendor', '__pycache__']);

/** classify() 复刻 —— CodeScanner.java:315-341 逐行对应 */
function classify(annotations, className, pkg) {
  const has = (a) => annotations.includes(a);
  if (has('@RestController') || has('@Controller')) return { layer: 'controller', by: 'annotation' };
  if (has('@Service')) return { layer: 'service', by: 'annotation' };
  if (has('@Repository')) return { layer: 'repository', by: 'annotation' };
  if (has('@Configuration')) return { layer: 'config', by: 'annotation' };
  if (className) {
    if (className.endsWith('Service') || className.endsWith('ServiceImpl')) return { layer: 'service', by: 'name' };
    if (className.endsWith('Repository') || className.endsWith('Mapper') || className.endsWith('Dao')) return { layer: 'repository', by: 'name' };
    if (className.endsWith('Controller')) return { layer: 'controller', by: 'name' };
    if (className.endsWith('Config') || className.endsWith('Configuration')) return { layer: 'config', by: 'name' };
    if (className.endsWith('Utils') || className.endsWith('Util') || className.endsWith('Helper') || className.endsWith('Tools')) return { layer: 'util', by: 'name' };
  }
  if (pkg && ['.domain', '.entity', '.model', '.dto', '.vo'].some((s) => pkg.includes(s))) return { layer: 'domain', by: 'package' };
  return { layer: null, by: null };
}

const WATCHED = ['@SpringBootApplication', '@RestController', '@ControllerAdvice', '@RestControllerAdvice', '@Controller', '@Service', '@Repository', '@Configuration', '@Component', '@Entity', '@FeignClient', '@Bean', '@ConfigurationProperties'];

function walk(dir, base, files) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP.has(e.name.toLowerCase())) continue;
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(abs, rel, files);
    else files.push(rel.replace(/\\/g, '/'));
  }
}

const allFiles = [];
walk(FIXTURE, '', allFiles);
const dirsMap = new Map();
for (const f of allFiles) {
  const slash = f.lastIndexOf('/');
  const d = slash > 0 ? f.slice(0, slash) : '';
  dirsMap.set(d, (dirsMap.get(d) ?? 0) + 1);
}

const classes = [];
for (const f of allFiles) {
  if (!f.endsWith('.java')) continue;
  const text = fs.readFileSync(path.join(FIXTURE, f), 'utf8');
  const lines = text.split(/\r?\n/);
  let pkg = null;
  let className = null;
  let classLine = null;
  const anns = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    if (pkg === null) {
      const pm = t.match(/^package\s+([\w.]+)\s*;/);
      if (pm) pkg = pm[1];
    }
    const am = t.match(/@(\w+)/g);
    if (am) for (const a of am) { const at = '@' + a.slice(1); if (WATCHED.includes(at) && !anns.includes(at)) anns.push(at); }
    if (className === null) {
      const cm = t.match(/\b(?:class|interface|enum|record)\s+(\w+)/);
      if (cm) { className = cm[1]; classLine = i + 1; }
    }
  }
  const { layer, by } = classify(anns, className, pkg);
  classes.push({ name: className, file: f, line: classLine, package: pkg, layer, layerBy: by, annotations: anns });
}
classes.sort((a, b) => (a.file < b.file ? -1 : 1));

const layersAgg = {};
for (const c of classes) if (c.layer) layersAgg[c.layer] = (layersAgg[c.layer] ?? 0) + 1;

const stale = JSON.parse(fs.readFileSync(STALE, 'utf8'));
const base = stale.receipts.find((r) => r.kind === 'facts').facts;
const facts = {
  ...base,
  root: path.basename(FIXTURE) || 'repo',
  code: {
    ...base.code,
    classes,
    dirs: [...dirsMap.entries()].map(([p, files]) => ({ path: p, files })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    layers: layersAgg,
    packages: [...dirsMap.entries()]
      .filter(([p]) => p.startsWith('src/main/java/'))
      .map(([p]) => ({ path: p.replace(/\//g, '.').replace(/^src\.main\.java\./, '').replace(/\./g, '/'), files: dirsMap.get(p) }))
      .filter((p) => p.path),
  },
  stats: { ...base.stats, files: allFiles.length, truncated: false },
};

fs.writeFileSync(OUT, JSON.stringify(facts, null, 2));
console.log(`classes=${classes.length} dirs=${facts.code.dirs.length} files=${allFiles.length}`);
console.log('layers =', JSON.stringify(layersAgg));
console.log('unclassified =', classes.filter((c) => !c.layer).map((c) => c.name).join(', '));
console.log('wrote', OUT);
