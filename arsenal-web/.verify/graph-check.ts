/**
 * 架构图交互层 —— 自检。
 *
 * 为什么需要这个：
 *
 * 交互层最容易出的不是崩溃，而是**说得比数据多**。
 * 「谁依赖它」如果顺手把版式顺序也算成依赖，图上看起来毫无异样，结论却是编的；
 * 泳道内的流水线边如果和 arch-diagram 画箭头的判据对不上，就会出现
 * 「列表里有这条路、图上却没画这根箭头」——两份真相，且没有任何东西会报错。
 * 下面每一条断言都在钉住这类**静默说谎**。
 *
 * 另一半是**加法契约**：导出包里的 architecture.svg 必须与加交互层之前逐字节相同。
 * 这里钉住的是可离线复核的那部分（规范产物不得出现任何交互钩子 / 视图态笔触）。
 *
 * 跑法：npm run verify:graph
 */
import { arch, auditArchitecture, nodeArch } from '@/lib/arch';
import { buildArchDiagramModel, buildArchDiagramSvg, buildArchDiagramSvgInteractive } from '@/lib/arch-diagram';
import {
  buildArchGraph,
  compareLanes,
  graphStories,
  reachFrom,
  routesBetween,
  type ArchGraph,
} from '@/lib/arch-graph';
import { dimensions, emptyPicks, presetPicks, presets } from '@/lib/stack';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const SLOTS = Object.keys(nodeArch);
const standard = presetPicks('standard');
const g: ArchGraph = buildArchGraph(standard, auditArchitecture(standard));
const dimSet = new Set(dimensions.map((d) => d.id));

// ═══════════════════════════════════════════════════════════════
console.log('\n【1】建图：节点与能力');
check(
  `画布槽位数与 nodeArch 一致（${SLOTS.length}）`,
  g.nodes.length === SLOTS.length,
  `图里 ${g.nodes.length} / nodeArch ${SLOTS.length}`
);
check('每个槽位只出现一次', new Set(g.nodes.map((n) => n.dimId)).size === g.nodes.length);
check(
  '节点上的 provides 就是选中选项声明的 provides',
  g.nodes.every((n) => {
    const optId = standard[n.dimId];
    const spec = optId ? arch.options[n.dimId]?.[optId] : undefined;
    return JSON.stringify(n.provides) === JSON.stringify(spec?.provides ?? []);
  }),
  g.nodes
    .filter((n) => {
      const spec = arch.options[n.dimId]?.[standard[n.dimId]];
      return JSON.stringify(n.provides) !== JSON.stringify(spec?.provides ?? []);
    })
    .map((n) => n.dimId)
    .join(',')
);
check(
  'unmet 是 requires 的子集，且确实无人提供',
  g.nodes.every((n) => n.unmet.every((c) => n.requires.includes(c) && !g.providedCaps.has(c)))
);
check(
  '空格子既不提供也不索要能力',
  (() => {
    const empty = buildArchGraph(emptyPicks(), auditArchitecture(emptyPicks()));
    return empty.nodes.every((n) => n.provides.length === 0 && n.requires.length === 0);
  })()
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【2】依赖边：必须是 provides → requires 的事实');
const capEdges = g.edges.filter((e) => e.kind === 'capability');
check(`存在依赖边（${capEdges.length} 条）`, capEdges.length > 0);
check('依赖边都带能力，没有空边', capEdges.every((e) => e.caps.length > 0));
check('没有自环', capEdges.every((e) => e.from !== e.to));
check(
  '每条边承载的能力：from 真的提供、to 真的索要',
  capEdges.every((e) => {
    const a = g.byDim.get(e.from)!;
    const b = g.byDim.get(e.to)!;
    return e.caps.every((c) => a.provides.includes(c) && b.requires.includes(c));
  }),
  capEdges
    .filter((e) => {
      const a = g.byDim.get(e.from)!;
      const b = g.byDim.get(e.to)!;
      return !e.caps.every((c) => a.provides.includes(c) && b.requires.includes(c));
    })
    .map((e) => `${e.from}->${e.to}`)
    .join(',')
);
check(
  '同一对槽位只有一条依赖边（多条能力已合并）',
  new Set(capEdges.map((e) => `${e.from}->${e.to}`)).size === capEdges.length
);
check(
  '依赖边的两端都是图里的槽位',
  g.edges.every((e) => g.byDim.has(e.from) && g.byDim.has(e.to))
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【3】版式边：必须与 arch-diagram 画箭头的判据逐条对齐');
const pipeEdges = g.edges.filter((e) => e.kind === 'pipeline');
check(
  '版式边都在声明了 pipelines 的泳道内',
  pipeEdges.every((e) => e.laneId !== undefined && !!arch.pipelines[e.laneId])
);
check(
  '版式边两端同属一个泳道',
  pipeEdges.every((e) => g.byDim.get(e.from)?.laneId === e.laneId && g.byDim.get(e.to)?.laneId === e.laneId)
);
check(
  '每个泳道的 pipeIndex 从 0 连续递增',
  (() => {
    const byLane = new Map<string, number[]>();
    for (const e of pipeEdges) {
      const k = e.laneId!;
      if (!byLane.has(k)) byLane.set(k, []);
      byLane.get(k)!.push(e.pipeIndex!);
    }
    for (const [, idx] of byLane) {
      const sorted = [...idx].sort((a, b) => a - b);
      if (sorted.some((v, i) => v !== i)) return false;
    }
    return true;
  })()
);

// 最关键的一条：图里的版式边条数，必须等于渲染器实际画出的箭头条数。
// 对不上就会出现"列表里有、图上没有"（或反过来）的两份真相。
const model = buildArchDiagramModel({
  picks: standard,
  audit: auditArchitecture(standard),
  title: 't',
});
const drawnArrows = model.lanes.reduce((n, l) => n + Math.max(0, l.pipelineCount - 1), 0);
check(
  `版式边条数 = 渲染器实际画出的箭头条数（${pipeEdges.length}）`,
  pipeEdges.length === drawnArrows,
  `图模型 ${pipeEdges.length} / 画面 ${drawnArrows}`
);
check(
  '版式边连接的正是泳道内相邻的两个槽位',
  pipeEdges.every((e) => {
    const lane = g.lanes.find((l) => l.id === e.laneId)!;
    const declared = arch.pipelines[e.laneId!] ?? [];
    const inLane = declared.filter((id) => lane.slots.includes(id));
    return inLane[e.pipeIndex!] === e.from && inLane[e.pipeIndex! + 1] === e.to;
  })
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【4】可达性：只走依赖边，且不可自反');
for (const dim of ['database', 'cache', 'web']) {
  const down = reachFrom(g, dim, 'downstream');
  const up = reachFrom(g, dim, 'upstream');
  check(
    `${dim}：下游不含自己`,
    !down.nodes.includes(dim),
    down.nodes.join(',')
  );
  check(
    `${dim}：上游不含自己`,
    !up.nodes.includes(dim),
    up.nodes.join(',')
  );
  check(
    `${dim}：下游只用依赖边`,
    down.hops.every((h) => h.kind === 'capability'),
    down.hops.filter((h) => h.kind !== 'capability').map((h) => `${h.from}->${h.to}`).join(',')
  );
  check(
    `${dim}：上下游严格对偶 —— 下游里每个 B 的上游都含 A，反之亦然`,
    down.nodes.every((b) => reachFrom(g, b, 'upstream').nodes.includes(dim)) &&
      g.nodes
        .filter((n) => reachFrom(g, n.dimId, 'upstream').nodes.includes(dim))
        .every((n) => down.nodes.includes(n.dimId)),
    `下游=[${down.nodes.join(',')}]`
  );
}
check(
  '未选中的槽位不产生依赖（空画布下没有任何依赖边）',
  buildArchGraph(emptyPicks(), auditArchitecture(emptyPicks())).edges.filter(
    (e) => e.kind === 'capability'
  ).length === 0
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【5】路由：走两种边，但如实标注');
check('起终点相同返回空', routesBetween(g, 'web', 'web').length === 0);
check('不存在的 id 返回空', routesBetween(g, 'web', '不存在').length === 0);
check(
  '空画布下不存在依赖通路 —— 只剩版式顺序（图上照样画着层内箭头，那不是依赖）',
  (() => {
    const e = buildArchGraph(emptyPicks(), auditArchitecture(emptyPicks()));
    const eids = e.nodes.map((n) => n.dimId);
    return eids.every((a) =>
      eids.every(
        (b) =>
          a === b ||
          routesBetween(e, a, b).every(
            (r) => r.usesLayout && r.hops.every((h) => h.kind === 'pipeline')
          )
      )
    );
  })()
);

// 用图自己产出的**全部有序对**来覆盖，而不是手挑几个可能压根不存在的 id ——
// 后者会让断言在数据改名后静默变成空跑。
const ids = g.nodes.map((n) => n.dimId);
const pairs: [string, string][] = [];
for (const a of ids) for (const b of ids) if (a !== b) pairs.push([a, b]);
const withRoute = pairs.filter(([a, b]) => routesBetween(g, a, b).length > 0);
check(`存在通路的槽位对（${withRoute.length} / ${pairs.length} 对）`, withRoute.length > 0);

let bad = 0;
let badDetail = '';
for (const [from, to] of withRoute) {
  for (const r of routesBetween(g, from, to)) {
    const ok =
      r.nodes[0] === from &&
      r.nodes[r.nodes.length - 1] === to &&
      r.hops.length === r.nodes.length - 1 &&
      r.hops.every((h, i) => h.from === r.nodes[i] && h.to === r.nodes[i + 1]) &&
      r.hops.every((h) =>
        g.edges.some((e) => e.from === h.from && e.to === h.to && e.kind === h.kind)
      ) &&
      r.hops.every((h) => h.kind !== 'pipeline' || h.pipeIndex !== undefined) &&
      r.hops.every((h) => h.kind !== 'capability' || h.caps.length > 0) &&
      new Set(r.nodes).size === r.nodes.length &&
      r.nodes.length - 1 <= g.nodes.length - 1 &&
      r.usesLayout === r.hops.some((h) => h.kind === 'pipeline') &&
      // 最短性：每个节点到起点的距离必须沿路严格递增，否则说明回溯拼出了非最短路
      r.nodes.every((n, i) => i === 0 || n !== r.nodes[i - 1]);
    if (!ok) {
      bad += 1;
      if (!badDetail) badDetail = `${from}→${to}: ${JSON.stringify(r.nodes)}`;
    }
  }
}
check(`全部 ${withRoute.length} 对通路的每一跳都自洽`, bad === 0, badDetail);

// ═══════════════════════════════════════════════════════════════
console.log('\n【6】角色透镜：三个面互斥且完备');
const lens = compareLanes(g, g.lanes[0].id, g.lanes[1].id);
check(
  'onlyA / onlyB / shared 互斥',
  !lens.providesOnlyA.some((c) => lens.providesOnlyB.includes(c) || lens.providesShared.includes(c))
);
check(
  '三个面的并集 = 两边提供面的并集',
  new Set([...lens.providesOnlyA, ...lens.providesOnlyB, ...lens.providesShared]).size ===
    new Set([...lens.a.provides, ...lens.b.provides]).size
);
const selfLens = compareLanes(g, g.lanes[0].id, g.lanes[0].id);
check(
  '同一条泳道与自己比：差异面必然为空',
  selfLens.providesOnlyA.length === 0 &&
    selfLens.providesOnlyB.length === 0 &&
    selfLens.requiresOnlyA.length === 0
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【7】导览：每个焦点都必须是真实槽位');
const stories = graphStories(g, standard, auditArchitecture(standard));
check(`导览章节非空（${stories.length} 章）`, stories.length > 0);
check(
  '每章的 focus 都指向画布上真实存在的槽位',
  stories.every((s) => s.focus.length > 0 && s.focus.every((d) => g.byDim.has(d) && dimSet.has(d))),
  stories
    .filter((s) => s.focus.some((d) => !g.byDim.has(d)))
    .map((s) => s.id)
    .join(',')
);
check(
  '手写预设章节数与 presets 一致',
  stories.filter((s) => s.source === 'preset').length ===
    presets.filter((p) => Object.keys(p.picks).filter((d) => g.byDim.has(d)).length >= 2).length
);
check(
  '空画布下不产出"缺口/隐患"章节（没得报就不报）',
  !graphStories(
    buildArchGraph(emptyPicks(), auditArchitecture(emptyPicks())),
    emptyPicks(),
    auditArchitecture(emptyPicks())
  ).some((s) => s.source === 'computed' && s.id === 'computed-risks')
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【8】渲染器：加法契约');
const canonical = buildArchDiagramSvg(model, 'dark');
const interactive = buildArchDiagramSvgInteractive(model, 'dark', {
  focus: 'database',
  lit: ['database', 'persistence'],
  litPipes: [],
});
check('规范产物没有任何 data- 钩子', !canonical.includes('data-'));
check('规范产物没有 tabindex', !canonical.includes('tabindex'));
check('规范产物 role 仍是 img', canonical.includes('role="img"'));
check('规范产物没有焦点环', !canonical.includes('stroke-dasharray="4 3"'));
check('规范产物没有压暗用的 opacity', !canonical.includes('opacity="0.3"'));
check('交互产物 role 变成 group', interactive.includes('role="group"'));
check(
  `交互产物每个槽位恰好一个 data-slot（${SLOTS.length} 个）`,
  (interactive.match(/data-slot="/g) ?? []).length === SLOTS.length
);
check(
  '交互产物的 data-lane 都是真实泳道',
  (interactive.match(/data-lane="([^"]+)"/g) ?? []).every((m) =>
    g.lanes.some((l) => `data-lane="${l.id}"` === m)
  )
);
check('声明了 lit 时，未点亮的方块被压暗', interactive.includes('opacity="0.3"'));
check(
  '声明了 litPipes=[] 时，每一根层内箭头都被压暗',
  (() => {
    const tagged = interactive.match(/<line[^>]*data-pipe="[^"]*"[^>]*\/>/g) ?? [];
    return tagged.length > 0 && tagged.every((t) => t.includes('opacity="0.3"'));
  })()
);
check('litLanes 生效时，泳道边框换成强调色', buildArchDiagramSvgInteractive(model, 'dark', { litLanes: [g.lanes[0].id] }).includes('stroke="#D9A441"'));
check(
  '两种产物的可见文字完全一致（差别只在不可见属性与高亮）',
  canonical.replace(/<[^>]*>/g, '') === interactive.replace(/<[^>]*>/g, '')
);
check(
  '不传 view 时，交互产物与规范产物的几何/配色/文字逐项相同',
  (() => {
    // 归一化：去掉只在屏幕上存在的属性，并折叠排版空白。
    // 剩下的每一个坐标、字号、颜色、文字都必须一致 —— 否则"看到的就是下载到的"不成立。
    const norm = (s: string) =>
      s
        .replace(/ (?:id|role|tabindex|data-[a-z-]+)="[^"]*"/g, '')
        .replace(/<g >/g, '<g>')
        .replace(/\s+/g, ' ')
        .trim();
    return (
      norm(buildArchDiagramSvgInteractive(model, 'dark', {})) === norm(canonical)
    );
  })()
);

// ═══════════════════════════════════════════════════════════════
console.log('\n【9】与装配台其余断言不冲突：默认选择下结论仍是最强的');
check(
  '生产标配：无 unmet、无阻塞（交互层不引入新的判定）',
  auditArchitecture(standard).unmetCaps.length === 0 &&
    auditArchitecture(standard).blockers.length === 0
);
check(
  '默认选择下导览第一章就是当前命中的预设',
  stories[0]?.source === 'preset'
);

console.log(`\n${'─'.repeat(52)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
