/**
 * 【22】部署形态动画层 —— 机理台（TopologyLab）与形态图元模型的守门层。
 *
 * 为什么单开一层（《部署形态动画化计划-2026-09-26》§5）：这一层守的是三类
 * 「静默变形 / 静默卡死」：
 *   ① **视觉静默变形** —— `topologyModeSvg()` 是迷你图与形态图卡片共用的全局几何，
 *      改它一行，全站形态图一起变。快照 fixture（重构前逐字符录制）锁死输出：
 *      想改几何必须显式重录快照，悄悄变形在这里直接红。
 *   ② **剧本悬空引用** —— highlight / active / token.edge 指向不存在的 id 时，
 *      播放时的表现是「这一帧静默不动」，页面不报错、用户只觉得坏了。
 *   ③ **数字与实例数说谎** —— 剧本画的节点数（client 不计）必须等于形态表的
 *      replicas（= K8s 副本数）：动画 3 个框、清单 2 个副本，是本项目最忌的「两个数字」。
 *
 * 数据链路：tools/content/stack_topology_flows.py → build-content.py（构建期已拦一轮）
 *   → arsenal-stacks/topology_flows.json → sync-content.mjs → src/generated/topology-flows.json
 *   → src/lib/topology-flows.ts。本层对着**前端消费到的同一份产物**再验一遍。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { check, finish } from './lib/report';
import { topologyModeSvg, topologyPalette, topologySpecOf } from '@/lib/topology';
import { dimensions } from '@/lib/stack';
import type { StackOption } from '@/lib/content-types';
import { topologyFlows } from '@/lib/topology-flows';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const read = (p: string) => fs.readFileSync(p, 'utf8');

// ═══════════════════════════════════════════════════════════════
// 【22】#9 快照比对 —— 本批最关键的护栏
// ═══════════════════════════════════════════════════════════════
console.log('\n【22-1】形态图快照（topologyModeSvg 逐字符一致）');
const snapPath = path.join(here, 'fixtures', 'topology-mode-snapshots.json');
let snap: {
  meta: { caseCount: number; geometry: string };
  cases: {
    modeId: string; replicas: number; shardCount?: number;
    x: number; y: number; w: number; h: number; theme: string; svg: string;
  }[];
} | null = null;
try {
  snap = JSON.parse(read(snapPath));
} catch {
  snap = null;
}
const snapModeIds = snap ? new Set(snap.cases.map((c) => c.modeId)) : new Set<string>();
check(
  `快照 fixture 存在且覆盖 13 个既有 modeId（${snap ? snap.cases.length : 0} 用例 / ${snapModeIds.size} modeId）`,
  !!snap && snap.cases.length >= 18 && snapModeIds.size >= 13,
  `${snapPath} 读不到或规模缩水 —— 快照是重构几何的护栏，删它等于拆闸门`
);
check(
  '快照 meta.caseCount 与实际用例数一致（重录快照必须重跑生成器，不许手改 JSON）',
  !!snap && snap.meta.caseCount === snap.cases.length,
  `meta 写 ${snap?.meta.caseCount} / 实际 ${snap?.cases.length}`
);

if (snap) {
  const diffs: string[] = [];
  for (const c of snap.cases) {
    const now = topologyModeSvg(
      c.modeId, c.replicas, c.x, c.y, c.w, c.h, topologyPalette(c.theme), c.shardCount ?? 4
    );
    if (now !== c.svg) {
      let at = -1;
      for (let i = 0; i < Math.max(now.length, c.svg.length); i += 1) {
        if (now[i] !== c.svg[i]) { at = i; break; }
      }
      diffs.push(
        `${c.modeId}(theme=${c.theme}) 首个差异在第 ${at} 字符\n` +
        `      旧: ${JSON.stringify((c.svg.slice(Math.max(0, at - 50)) || '').slice(0, 100))}\n` +
        `      新: ${JSON.stringify((now.slice(Math.max(0, at - 50)) || '').slice(0, 100))}`
      );
    }
  }
  check(
    `topologyModeSvg 输出与重构前快照逐字符一致（${snap.cases.length} 用例全过）`,
    diffs.length === 0,
    `${diffs.length} 例变形：\n      ${diffs.slice(0, 3).join('\n      ')}`
      + '\n      迷你图与形态图卡片共用这段几何 —— 要改几何，先重录快照并写明理由'
  );
}

// 新形态（如本批的 sentinel）必须在渲染器里有得画：不抛异常、输出非空、
// 且不能落在「按 replicas 排一排」的兜底分支里还挂着错误的标注文字。
{
  const allModeIds = new Set<string>();
  for (const dim of dimensions) {
    const spec = (dim as unknown as { topology?: { modes: { id: string }[] } }).topology;
    for (const m of spec?.modes ?? []) allModeIds.add(m.id);
    for (const opt of dim.options) {
      const ospec = (opt as unknown as { topology?: { modes: { id: string }[] } }).topology;
      for (const m of ospec?.modes ?? []) allModeIds.add(m.id);
    }
  }
  const undrawable: string[] = [];
  for (const modeId of allModeIds) {
    try {
      const svg = topologyModeSvg(modeId, 3, 0, 0, 304, 94, topologyPalette('dark'), 4);
      if (!svg.includes('<rect')) undrawable.push(`${modeId}（一个方块都没画出来）`);
    } catch (e) {
      undrawable.push(`${modeId}（渲染抛异常：${(e as Error).message.slice(0, 60)}）`);
    }
  }
  check(
    `TOPOLOGY 的每个形态 id 都能画（当前 ${allModeIds.size} 个，含按选项拆分后的新增形态）`,
    undrawable.length === 0,
    undrawable.join('；') || '（无）'
  );

  // 覆盖断言（2026-09-28 补）：快照里必须有「当前每个形态 id」的用例 ——
  // 否则新增形态（如 sentinel）没进快照，改它的几何永远不红，护栏上有洞。
  if (snap) {
    const uncovered = [...allModeIds].filter((id) => !snapModeIds.has(id));
    check(
      `TOPOLOGY 的每个形态 id 都被快照覆盖（${allModeIds.size} 个形态 / 快照含 ${snapModeIds.size} 个 modeId）`,
      uncovered.length === 0,
      uncovered.length
        ? `快照缺这些形态的用例：${uncovered.join('、')} —— 跑 .verify/topology-snapshot-gen.ts 重录（提交说明写理由）`
        : '（全覆盖）'
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 【22】#1-#8 / #10 剧本内容校验（对前端消费的同一份产物验）
// ═══════════════════════════════════════════════════════════════
console.log('\n【22-2】机理剧本（scenes / 引用 / 实例数 / 出处）');

type FlowNode = { id: string; kind: string };
type FlowEdge = { id: string; from: string; to: string };
type FlowScene = {
  id: string; title: string; refs: string[];
  steps: { caption: string; highlight?: string[]; active?: string[]; token?: { edge: string; label: string } }[];
};
type Flow = { nodes: FlowNode[]; edges: FlowEdge[]; scenes: FlowScene[] };
type FlowRecord = { at: string; flow: Flow; replicas: number | null; caffeine: boolean };

const flowRecords: FlowRecord[] = [];
for (const [dimId, opts] of Object.entries(topologyFlows.flows ?? {})) {
  for (const [optId, modes] of Object.entries(opts)) {
    for (const [modeId, flow] of Object.entries(modes)) {
      const dim = dimensions.find((d) => d.id === dimId);
      const opt: StackOption | null = dim?.options.find((o) => o.id === optId) ?? null;
      const mode = topologySpecOf(dimId, opt)?.modes.find((m) => m.id === modeId) ?? null;
      flowRecords.push({
        at: `${dimId}/${optId}/${modeId}`,
        flow: flow as unknown as Flow,
        replicas: mode?.replicas ?? null,
        caffeine: optId === 'caffeine',
      });
    }
  }
}
check(
  `机理剧本样本量 > 0（${flowRecords.length} 个形态剧本，P0-1 应有 cache/redis 的 single + masterslave）`,
  flowRecords.length >= 2 && flowRecords.some((r) => r.at === 'cache/redis/single') &&
    flowRecords.some((r) => r.at === 'cache/redis/masterslave'),
  '剧本为空或缺 P0-1 的两个形态 —— 事实源没挂上或忘了 build + sync'
);

{
  const broken: string[] = [];
  for (const r of flowRecords) {
    const got = new Set(r.flow.scenes.map((s) => s.id));
    for (const need of ['read', 'write', 'failover']) {
      if (!got.has(need)) broken.push(`${r.at} 缺 ${need} 场景`);
    }
    if (got.size !== r.flow.scenes.length) broken.push(`${r.at} 场景 id 重复`);
  }
  check(
    '每个形态剧本的场景三问齐备（read / write / failover，缺一即红）',
    broken.length === 0,
    broken.join('；') || '（全部齐备）'
  );
}

{
  const dangling: string[] = [];
  for (const r of flowRecords) {
    const nodeIds = new Set(r.flow.nodes.map((n) => n.id));
    const edgeIds = new Set(r.flow.edges.map((e) => e.id));
    for (const e of r.flow.edges) {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
        dangling.push(`${r.at} 边 ${e.id} 端点悬空`);
      }
    }
    for (const s of r.flow.scenes) {
      s.steps.forEach((st, i) => {
        for (const h of st.highlight ?? []) {
          if (!nodeIds.has(h)) dangling.push(`${r.at}/${s.id} 第${i + 1}步 highlight 悬空 ${h}`);
        }
        for (const a of st.active ?? []) {
          if (!edgeIds.has(a)) dangling.push(`${r.at}/${s.id} 第${i + 1}步 active 悬空 ${a}`);
        }
        if (st.token && !edgeIds.has(st.token.edge)) {
          dangling.push(`${r.at}/${s.id} 第${i + 1}步 token 悬空 ${st.token.edge}`);
        }
      });
    }
  }
  check(
    'highlight / active / token.edge / 边端点引用全部存在（悬空 = 播放时静默不动）',
    dangling.length === 0,
    dangling.slice(0, 5).join('；') || '（无悬空）'
  );
}

{
  const bad: string[] = [];
  for (const r of flowRecords) {
    const nodeIds = new Set(r.flow.nodes.map((n) => n.id));
    for (const e of r.flow.edges) {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) bad.push(`${r.at} 的边 ${e.id}`);
    }
  }
  check('edges[].from / edges[].to 指向的节点都存在', bad.length === 0, bad.join('；') || '（全部命中）');
}

{
  const bad: string[] = [];
  for (const r of flowRecords) {
    const drawn = r.flow.nodes.filter((n) => n.kind !== 'client').length;
    if (r.replicas === null) bad.push(`${r.at} 在 TOPOLOGY 里找不到对应形态（replicas 无从比对）`);
    else if (drawn !== r.replicas) {
      bad.push(`${r.at} 画了 ${drawn} 个实例（client 不计）≠ replicas ${r.replicas}`);
    }
  }
  check(
    '剧本画的实例数（client 不计）== 该形态 replicas == K8s 副本数（硬红线 #4）',
    bad.length === 0,
    bad.join('；') || flowRecords.map((r) => `${r.at}=${r.replicas}`).join(' / ')
  );
}

{
  const digitRe = /[0-9０-９]/;
  const bad: string[] = [];
  for (const r of flowRecords) {
    for (const s of r.flow.scenes) {
      const hasDigit = s.steps.some((st) => digitRe.test(st.caption));
      if (hasDigit && !(s.refs ?? []).length) {
        bad.push(`${r.at}/${s.id} 旁白含数字但场景没有 refs`);
      }
    }
  }
  check('caption 含数字时场景必带 refs（数字不许编造，D5）', bad.length === 0, bad.join('；') || '（有数字处均有出处）');
}

{
  const short: string[] = [];
  for (const r of flowRecords) {
    for (const s of r.flow.scenes) {
      if (s.steps.length < 3) short.push(`${r.at}/${s.id} 只有 ${s.steps.length} 步`);
    }
  }
  check('每个场景 steps ≥ 3（一步就演完等于没讲清）', short.length === 0, short.join('；') || '（全部达标）');
}

{
  const long: string[] = [];
  for (const r of flowRecords) {
    for (const s of r.flow.scenes) {
      s.steps.forEach((st, i) => {
        if (!st.caption || st.caption.length > 40) {
          long.push(`${r.at}/${s.id} 第${i + 1}步 ${st.caption?.length ?? 0} 字`);
        }
      });
    }
  }
  check('caption ≤ 40 字（旁白是字幕不是课文）', long.length === 0, long.join('；') || '（全部达标）');
}

// ═══════════════════════════════════════════════════════════════
// 【22】#3 / #7 caffeine 回归红线 + 播放器源码契约
// ═══════════════════════════════════════════════════════════════
console.log('\n【22-3】形态表拆分回归 + 播放器契约');
{
  // 修 bug 回归：Caffeine（进程内本地缓存）不得出现主从 / 哨兵 / 集群。
  // 判据走前端消费的同一份数据（topologySpecOf），与 TopologyPicker 看到的完全一致。
  const dim = dimensions.find((d) => d.id === 'cache');
  const caffeine = dim?.options.find((o) => o.id === 'caffeine') ?? null;
  const modeIds = topologySpecOf('cache', caffeine)?.modes.map((m) => m.id) ?? [];
  const bad = modeIds.filter((id) => ['masterslave', 'cluster', 'sentinel'].includes(id));
  check(
    `Caffeine 的可选形态只有本地缓存说得通的形态（当前 [${modeIds.join(', ')}]）`,
    caffeine !== null && modeIds.length > 0 &&
      modeIds.every((id) => ['single', 'multilevel'].includes(id)) &&
      bad.length === 0,
    `Caffeine 出现了不该有的形态：${bad.join('、') || '无'} —— 本地缓存没有「主从 / 集群」这个概念（09-27 修掉的 bug 回潮了）`
  );
  check(
    'Caffeine 没有机理剧本（剧本侧同样不许出现）',
    !topologyFlows.flows?.cache?.caffeine,
    '本地缓存不播放主从 / 集群动画 —— 剧本写给它就是又在教错东西'
  );
}

{
  const src = read(path.join(webRoot, 'src', 'app', 'stack', 'TopologyLab.tsx'));
  check(
    '播放器尊重 prefers-reduced-motion（matchMedia 判定 + 自动播放停用 + token CSS 停行进）',
    src.includes('prefers-reduced-motion') &&
      /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(src) &&
      /if \(mq\.matches\) setPlaying\(false\)/.test(src) &&
      /@media \(prefers-reduced-motion:reduce\)\{\.tp-token\{animation:none\}\}/.test(src) &&
      /disabled=\{reduce\}/.test(src),
    '播放器少了 reduced-motion 的任意一段 —— 无障碍退化是本层的硬约定 #8'
  );
}

{
  const stepSrc = read(path.join(webRoot, 'src', 'app', 'stack', 'steps', 'TopologyStep.tsx'));
  const pickerSrc = read(path.join(webRoot, 'src', 'app', 'stack', 'TopologyPicker.tsx'));
  check(
    '播放器默认收起（TopologyStep labOpen 初始 false + aria-expanded；默认不渲染播放面板）',
    /const \[labOpen, setLabOpen\] = useState\(false\)/.test(stepSrc) &&
      /aria-expanded=\{labOpen\}/.test(stepSrc) &&
      /\{labOpen && \(/.test(stepSrc),
    '机理台默认展开会把 ⑤ 的五根滑杆挤没 —— 折叠是拍板过的决策 #12'
  );
  check(
    '「▷ 看机理」按钮只为有机理剧本的形态出现（hasTopologyFlow 过滤，无剧本 = 无按钮的如实空态）',
    pickerSrc.includes('hasTopologyFlow(dimId, option.id, mode.id)') &&
      pickerSrc.includes('data-topology-explain={mode.id}'),
    '按钮判据不是 hasTopologyFlow —— 迟早出现「点了全是空面板」的假入口'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【22】#11 类型 ↔ 事实源双向比 + 忘 sync 检测
// ═══════════════════════════════════════════════════════════════
console.log('\n【22-4】类型 ↔ 事实源双向 + 同步产物一致性');
{
  const typesSrc = read(path.join(webRoot, 'src', 'lib', 'content-types.ts'));

  /** 抓 interface 的顶层字段（与 project-check【16】同一套剥注释逻辑的精简版） */
  const ifaceFields = (name: string): { field: string; optional: boolean }[] => {
    const m = new RegExp(`export interface ${name}\\s*\\{`).exec(typesSrc);
    if (!m) return [];
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < typesSrc.length) {
      if (typesSrc[i] === '{') depth += 1;
      else if (typesSrc[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    const body = typesSrc
      .slice(start, i)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const out: { field: string; optional: boolean }[] = [];
    for (const mm of body.matchAll(/(?:^|\n)\s*([A-Za-z_$][\w$]*)(\??)\s*:/g)) {
      out.push({ field: mm[1], optional: mm[2] === '?' });
    }
    return out;
  };

  // A 方向（类型 → 数据）：必选字段在每条剧本记录上都必须真的有
  const nodeReq = ifaceFields('TopologyFlowNode').filter((f) => !f.optional).map((f) => f.field);
  const edgeReq = ifaceFields('TopologyFlowEdge').filter((f) => !f.optional).map((f) => f.field);
  const sceneReq = ifaceFields('TopologyFlowScene').filter((f) => !f.optional).map((f) => f.field);
  const stepReq = ifaceFields('TopologyFlowStep').filter((f) => !f.optional).map((f) => f.field);
  const missing: string[] = [];
  for (const r of flowRecords) {
    for (const n of r.flow.nodes) {
      for (const f of nodeReq) if (!(f in (n as unknown as Record<string, unknown>))) missing.push(`${r.at} 节点缺 ${f}`);
    }
    for (const e of r.flow.edges) {
      for (const f of edgeReq) if (!(f in (e as unknown as Record<string, unknown>))) missing.push(`${r.at} 边缺 ${f}`);
    }
    for (const s of r.flow.scenes) {
      for (const f of sceneReq) if (!(f in (s as unknown as Record<string, unknown>))) missing.push(`${r.at}/${s.id} 场景缺 ${f}`);
      for (const st of s.steps) {
        for (const f of stepReq) if (!(f in (st as unknown as Record<string, unknown>))) missing.push(`${r.at}/${s.id} 步骤缺 ${f}`);
      }
    }
  }
  check(
    '类型 → 数据：TopologyFlow* 必选字段在每条剧本上都在（类型不许对数据撒谎）',
    missing.length === 0,
    missing.slice(0, 5).join('；') || '（全部对得上）'
  );

  // B 方向（数据 → 类型）：数据里出现的每个 key 都必须能在类型文件里找到名字 ——
  // 事实源加了字段而类型没跟上，前端从此静默丢数据。
  // ⚠️ `flows[维度id][选项id][形态id]` 那三层是 Record 的**索引键**（'cache' / 'redis' /
  // 'single'…），不是字段名 —— 类型里对应的是 `Record<string, …>`，把它们扫进去
  // 等于要求类型声明一个叫 "redis" 的字段。所以顶层静态字段单独收，
  // 嵌套字段只从**剧本对象本身**往里走。
  const dataKeys = new Set<string>(Object.keys(topologyFlows));
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        dataKeys.add(k);
        walk(v);
      }
    }
  };
  for (const opts of Object.values(topologyFlows.flows ?? {})) {
    for (const modes of Object.values(opts)) {
      for (const flow of Object.values(modes)) walk(flow);
    }
  }
  const unknownKeys = [...dataKeys].filter((k) => !typesSrc.includes(k));
  check(
    `数据 → 类型：剧本 JSON 的 ${dataKeys.size} 个字段名全部能在 content-types.ts 找到（加字段漏改类型 = 静默丢数据）`,
    unknownKeys.length === 0,
    `类型里没有这些字段名：${unknownKeys.join('、')}`
  );

  // 忘 sync 检测：事实源与同步产物必须逐字节一致
  const factPath = path.join(repoRoot, 'arsenal-stacks', 'topology_flows.json');
  const genPath = path.join(webRoot, 'src', 'generated', 'topology-flows.json');
  let same = false;
  try {
    same = read(factPath) === read(genPath);
  } catch {
    same = false;
  }
  check(
    '事实源 arsenal-stacks/topology_flows.json == 同步产物 src/generated/topology-flows.json（逐字节）',
    same,
    '两侧不一致 —— 改了事实源忘了 `node scripts/sync-content.mjs`（verify-all 会先跑 sync，单跑本层时记得手动 sync）'
  );
}

process.exit(finish('topology'));
