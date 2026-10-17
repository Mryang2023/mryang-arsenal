/**
 * 项目结构派生层（纯函数）—— 2026-10-17 结构面板棒2。
 *
 * **判据全在 Java 侧**（`CodeScanner.classify()` 三档：注解 / 类名后缀 / 包名）：
 * 本文件只做分组与展示 —— 组树、上徽标、写释义、序列化 Markdown。
 * 不 second-guess 分类结果（10-04「判定逻辑两份实现」事故）。
 *
 * 词汇表单一出处：层级名与释义逐字复用 `arch-layered.ts` 的
 * `BAND_NAME` / `BAND_DESC`（`scan-check` 有断言逐字钉死）——
 * 结构图与分层图不许各说一套层名。
 *
 * 设计原则（计划书 §1）：判定带依据 / 分类机一份 / 词汇表一份 /
 * 判不出就是未分类 / 0 和空也是结论。
 */
import { BAND_DESC, BAND_NAME, BAND_ORDER, type LayerBandId } from './arch-layered';

/**
 * 类角色 → 带。与 `buildLayeredArch` 的带构造同口径：
 * api=Controller、app=Service+Config、domain=Domain、data=Repository。
 * `util` 是横切（工具类不属于某一业务层）→ 不进带；
 * `null`（未分类）→ 不进带。改这张表先改分层图，断言盯着。
 */
const LAYER_TO_BAND: Record<string, LayerBandId | null> = {
  controller: 'api',
  service: 'app',
  config: 'app',
  domain: 'domain',
  repository: 'data',
  util: null,
};

/** 类角色徽标（与带名是另一个轴：带答「哪一层」，徽标答「什么角色」） */
const LAYER_LABEL: Record<string, string> = {
  controller: '控制器',
  service: '服务',
  repository: '仓储',
  config: '配置',
  domain: '领域',
  util: '工具',
};

/** 判据出处徽标 —— 误判了要知道是哪一档猜的 */
const LAYER_BY_LABEL: Record<string, string> = {
  annotation: '据注解',
  name: '据类名',
  package: '据包名',
};

export interface StructureClass {
  name: string | null;
  file: string;
  line: number | null;
  package: string | null;
  layer: string | null;
  layerBy: string | null;
  annotations: string[];
}

export interface StructureDir {
  /** 目录相对路径；'' = 仓库根 */
  path: string;
  /** 直接文件数（`dirs[]` 直取；中间目录没有直接文件时为 0） */
  files: number;
  /** 子树文件总数（含子目录）—— 中间目录的 files 是 0，读结构要看它 */
  total: number;
  /** 挂在这个目录下的类数 */
  java: number;
  classes: StructureClass[];
  children: StructureDir[];
}

export interface StructureLayerRow {
  id: LayerBandId | 'util' | 'unclassified';
  /** 层级名 —— 五带逐字取自 BAND_NAME */
  name: string;
  /** 一句「这一层是什么」—— 五带逐字取自 BAND_DESC */
  desc: string;
  /** 这一层有哪些包（包名前三段聚合，与 facts.code.packages 同口径） */
  packages: string[];
  count: number;
}

export interface CodeStructure {
  root: string;
  tree: StructureDir;
  /** 五带 + 工具（横切）+ 未分类，顺序固定 */
  layers: StructureLayerRow[];
  /** 未分类桶：判不出的类单独列，不塞层 */
  unclassified: StructureClass[];
  stats: { files: number; dirs: number; classes: number; truncated: boolean };
  /** 结论句：0 和空也要说（「未扫到 Java 类」不是空树） */
  notes: string[];
}

/** 字典序 —— 不用 localeCompare，跨环境逐字节确定 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 包名前三段（与 facts.code.packages 的既定口径一致） */
function pkgPrefix(pkg: string | null): string | null {
  if (!pkg) return null;
  const segs = pkg.split('.');
  return segs.slice(0, 3).join('.');
}

function uniqSorted(values: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (v) out.add(v);
  return [...out].sort(cmp);
}

/** 角色徽标全文：控制器（据注解）—— 依据角标永不省 */
export function classBadge(c: StructureClass): string {
  const role = c.layer ? (LAYER_LABEL[c.layer] ?? c.layer) : '未分类';
  const by = c.layerBy ? (LAYER_BY_LABEL[c.layerBy] ?? c.layerBy) : '无依据';
  return `${role}（${by}）`;
}

/**
 * 组树：`dirs[]` 为骨架（含全部祖先节点，中间目录 files=0 —— 0 也是结论），
 * `classes[]` 按 `file` 的父目录挂上去。排序全部固定 → 同 facts 两跑相等。
 */
function buildTree(dirs: { path: string; files: number }[], classes: StructureClass[]): StructureDir {
  const nodes = new Map<string, StructureDir>();
  const ensure = (path: string): StructureDir => {
    let n = nodes.get(path);
    if (!n) {
      n = { path, files: 0, total: 0, java: 0, classes: [], children: [] };
      nodes.set(path, n);
    }
    return n;
  };
  for (const d of dirs) {
    const n = ensure(d.path);
    n.files = d.files;
  }
  // 目录的祖先也要在树里（只有子目录、没有直接文件的目录不在 dirs[] 中）
  for (const d of dirs) {
    if (!d.path) continue;
    const segs = d.path.split('/');
    for (let i = 1; i < segs.length; i++) ensure(segs.slice(0, i).join('/'));
  }
  const root = ensure('');

  for (const c of classes) {
    const slash = c.file.lastIndexOf('/');
    const parent = slash > 0 ? c.file.slice(0, slash) : '';
    // 同一趟扫描的产物，父目录必然在树里；防御性落根，不丢类
    const node = nodes.get(parent) ?? root;
    node.classes.push(c);
    node.java++;
  }

  // 父子挂接 + 排序
  for (const n of nodes.values()) n.classes.sort((a, b) => cmp(a.name ?? '', b.name ?? ''));
  const byPath = [...nodes.values()].sort((a, b) => cmp(a.path, b.path));
  for (const n of byPath) {
    if (!n.path) continue;
    const slash = n.path.lastIndexOf('/');
    const parent = slash > 0 ? n.path.slice(0, slash) : '';
    (nodes.get(parent) ?? root).children.push(n);
  }
  for (const n of nodes.values()) n.children.sort((a, b) => cmp(a.path, b.path));

  // 子树文件总数（后序：先子后父）。中间目录 files=0 但有 total，
  // 否则树上写「0 文件」是在说一个没测过的结论。
  // 深度用段数算（根 '' 记 0 层 —— 它和顶层目录必须分开先后）
  const byDepth = [...nodes.values()].sort(
    (a, b) => (b.path ? b.path.split('/').length : 0) - (a.path ? a.path.split('/').length : 0)
  );
  for (const n of byDepth) {
    n.total = n.files + n.children.reduce((s, c) => s + c.total, 0);
  }
  return root;
}

/** facts → 项目结构。纯函数：同一份 facts 跑两次逐字段相等（断言盯着） */
export function buildCodeStructure(facts: {
  root: string;
  stats?: { files?: number; truncated?: boolean };
  code?: { layers?: Record<string, number>; classes?: StructureClass[]; dirs?: { path: string; files: number }[] };
}): CodeStructure {
  const classes = facts.code?.classes ?? [];
  const dirs = facts.code?.dirs ?? [];
  const tree = buildTree(dirs, classes);
  const unclassified = classes.filter((c) => !c.layer).sort((a, b) => cmp(a.file, b.file));

  const inBand = (id: LayerBandId) => classes.filter((c) => c.layer && LAYER_TO_BAND[c.layer] === id);
  const layers: StructureLayerRow[] = BAND_ORDER.map((id) => {
    const members = inBand(id);
    return {
      id,
      name: BAND_NAME[id],
      desc: BAND_DESC[id],
      packages: uniqSorted(members.map((c) => pkgPrefix(c.package))),
      count: members.length,
    };
  });
  const utilClasses = classes.filter((c) => c.layer === 'util');
  layers.push({
    id: 'util',
    name: '工具',
    desc: '横切：工具类（Utils / Util / Helper / Tools 后缀）—— 不属于某一业务层，据类名推断',
    packages: uniqSorted(utilClasses.map((c) => pkgPrefix(c.package))),
    count: utilClasses.length,
  });
  layers.push({
    id: 'unclassified',
    name: '未分类',
    desc: '注解、类名后缀、包名都对不上（含 @Component 杂项）—— 判不出就是判不出，不塞层',
    packages: uniqSorted(unclassified.map((c) => pkgPrefix(c.package))),
    count: unclassified.length,
  });

  const notes: string[] = [];
  if (classes.length === 0) {
    notes.push('未扫到 Java 类（纯前端或非 Java 项目）—— 以下只有目录计数，0 也是结论');
  }
  if (facts.stats?.truncated) {
    notes.push(
      '扫描被闸门截断（单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s）—— 结构可能不全'
    );
  }
  notes.push('被 ScanGuard 跳过的目录（.git / node_modules / target 等）不在树里 —— 树是「读过的文件」，不是磁盘全貌');

  return {
    root: facts.root,
    tree,
    layers,
    unclassified,
    stats: {
      files: facts.stats?.files ?? dirs.reduce((s, d) => s + d.files, 0),
      dirs: dirs.length,
      classes: classes.length,
      truncated: Boolean(facts.stats?.truncated),
    },
    notes,
  };
}

function walkTree(node: StructureDir, depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth);
  const label = node.path ? node.path.split('/').pop() : '(仓库根)';
  // 中间目录直接文件是 0 —— 报子树总数才不是误导
  const fileLabel =
    node.total === node.files ? `${node.files} 文件` : `${node.total} 文件（${node.files} 直接在此）`;
  lines.push(`${pad}- ${label}/ —— ${fileLabel}` + (node.java ? ` · ${node.java} 类` : ''));
  for (const c of node.classes) {
    lines.push(`${pad}  - ${c.name ?? '（无名类）'} —— ${classBadge(c)}`);
  }
  for (const child of node.children) walkTree(child, depth + 1, lines);
}

/** Markdown 导出：层级释义 + 目录树，头部带 stats（与「下载事实 JSON / 下载 SVG」同款出口） */
export function structureMarkdown(s: CodeStructure): string {
  const lines: string[] = [];
  lines.push(`# ${s.root} 项目结构`, '');
  lines.push(
    `- 文件 ${s.stats.files} · 目录 ${s.stats.dirs} · Java 类 ${s.stats.classes}` +
      (s.stats.truncated ? ' · **扫描被闸门截断，结构可能不全**' : '')
  );
  for (const n of s.notes) lines.push(`- ${n}`);
  lines.push('', '## 层级释义', '');
  for (const r of s.layers) {
    lines.push(
      `- **${r.name}**（${r.count} 个类）：${r.desc}` +
        (r.packages.length ? ` —— ${r.packages.join('、')}` : '')
    );
  }
  lines.push('', '## 目录树', '');
  walkTree(s.tree, 0, lines);
  lines.push('');
  return lines.join('\n');
}
