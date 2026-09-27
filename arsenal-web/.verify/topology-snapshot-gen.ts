/**
 * 快照重录工具 —— 对**当前** topologyModeSvg() 重新生成快照 fixture。
 *
 * 什么时候跑：给形态表新增形态、或（有充分理由地）改动拓扑图元几何之后。
 * 跑法：cd arsenal-web && ./node_modules/.bin/tsx .verify/topology-snapshot-gen.ts
 *
 * ⚠️ 重录 = 显式承认几何变了 —— 提交说明里必须写理由；
 *    topology-check.ts 的覆盖断言会要求「TOPOLOGY 的每个形态 id 都在快照里」，
 *    新增形态忘了重录，那一层直接红。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { topologyModeSvg, topologyPalette } from '../src/lib/topology';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const outPath = path.resolve(here, 'fixtures', 'topology-mode-snapshots.json');

// 每个 modeId 用它在当前 TOPOLOGY 表里的真实 replicas；shardCount 用 PARAM_SPECS 的 fallback 4。
// 另补：default 兜底分支、参数化变体、三种调色板、非零偏移几何。
// 2026-09-28：replicaset 已从形态表消失（仅存于能力名 cap.topo.replicaset），用例移除；
//             sentinel（P0-1 交付的哨兵形态）补录，并配 2026-09-28 新增的专属小图分支。
const CASES: {
  modeId: string; replicas: number; shardCount?: number;
  x?: number; y?: number; w?: number; h?: number; theme?: string; why?: string;
}[] = [
  { modeId: 'single', replicas: 1 },
  { modeId: 'masterslave', replicas: 2 },
  { modeId: 'mgr', replicas: 3 },
  { modeId: 'cluster', replicas: 3 },
  { modeId: 'sentinel', replicas: 3 },
  { modeId: 'sharded', replicas: 4 },
  { modeId: 'cloudnative', replicas: 3 },
  { modeId: 'multilevel', replicas: 2 },
  { modeId: 'tiered', replicas: 2 },
  { modeId: 'multiaz', replicas: 3 },
  { modeId: 'multi', replicas: 3 },
  { modeId: 'canary', replicas: 2 },
  { modeId: 'generic-fallback', replicas: 5, why: 'switch default 分支：未知 modeId 按 replicas 画一排' },
  { modeId: 'sharded', replicas: 4, shardCount: 8, why: '滑杆 shardCount=8 的参数化变体' },
  { modeId: 'multi', replicas: 5, why: 'replicas=5 的参数化变体' },
  { modeId: 'single', replicas: 1, x: 16, y: 42, why: '卡片内非零偏移几何（x/y 必须参与定位）' },
  { modeId: 'masterslave', replicas: 2, theme: 'light' },
  { modeId: 'masterslave', replicas: 2, theme: 'blueprint' },
];

const doc = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    generator: 'topologyModeSvg()（arsenal-web/src/lib/topology.ts → topology-figure.ts）当前实现的逐字符快照',
    generatorScript: '.verify/topology-snapshot-gen.ts（重录跑它，别手改 JSON）',
    geometry: 'w=304 h=94 —— TopologyPicker 迷你图与 buildTopologySvg 卡片内的同一段几何',
    caseCount: CASES.length,
    note: '【22】层逐字符比对这份 fixture；改几何必须先重生成本文件并说明理由。覆盖断言：TOPOLOGY 的每个形态 id 必须出现在这里',
  },
  cases: CASES.map((c) => {
    const x = c.x ?? 0;
    const y = c.y ?? 0;
    const w = c.w ?? 304;
    const h = c.h ?? 94;
    const theme = c.theme ?? 'dark';
    return {
      ...c,
      x, y, w, h, theme,
      svg: topologyModeSvg(c.modeId, c.replicas, x, y, w, h, topologyPalette(theme), c.shardCount ?? 4),
    };
  }),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`written ${outPath} with ${CASES.length} cases, modeIds=${[...new Set(CASES.map((c) => c.modeId))].length}`);
