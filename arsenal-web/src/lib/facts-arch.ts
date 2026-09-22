/**
 * 代码事实 → 图的适配层（纯函数，不依赖 React）。
 *
 * 上游是后端 `com.arsenal.scan` 扫出来的 `ProjectFacts`（只读的事实 JSON），
 * 下游是三个**已有的**渲染器：
 *
 *   ① `buildTechArch(picks)` + `buildTechArchSvg(arch, theme)`  —— 部署架构图（本文件）
 *   ② `buildLayeredArch(facts)` + `buildLayeredSvg(layered, theme)` —— 应用分层图（`arch-layered.ts`）
 *   ③ `buildArchifyIr(arch)` → 后端 `/api/archify/deliver`      —— 交付级 HTML（本文件）
 *
 * 四条不能破的规矩：
 *
 *   ① **只做翻译，不做判断。**facts 里没读到的值，在这一层仍然「没有」——
 *      图上少一个节点，比图上多一个编出来的节点安全得多。
 *   ② **facts → 选型是纯查表。**`SCAN_RULES` 里 `tech → {dim, opt}`，
 *      命中的写进 picks；没有 dim 的（工具库 / 编码期依赖）进 unmatched，不许静默丢弃。
 *   ③ **同维度冲突给确定性结果。**一个 dim 被多条命中时，按规则表顺序取第一条，
 *      被放弃的写进 conflicts 并说清「同维取 X，未取 Y」，不许随机。
 *   ④ **部署声明只认读到的文件。**副本数要么来自 K8s `replicas` / Helm `replicaCount`
 *      并写明出处，要么就是「没读到」——**不默认 1、不默认 3**。
 *
 * ⚠️ 改这个文件时先想一件事：这一层没有自己的「知识」。任何「这个项目大概是这样」
 * 的推断都应该回到 `tools/content/scan_rules.py`（技术映射）或后端扫描器（读事实）去，
 * 写在这里的推断没人能复核。
 */

import {
  buildTechArch,
  emptyEdits,
  type CanvasEdits,
  type CanvasTheme,
  type TechArch,
} from './arch-canvas';
import { buildArchifyIr, type ArchifyIr, type ArchifyIrOptions } from './archify-ir';
import { SCAN_RULES } from './scan-rules';
import type { StackPicks } from './content-types';
import {
  buildLayeredArch,
  buildLayeredSvg,
  type CrossCall,
  type LayerBandId,
  type LayeredArchData,
  type LayeredBand,
  type LayeredEdge,
  type LayeredGroup,
} from './arch-layered';

// 链路 ② 从 `facts-arch` 一处出口 —— 调用方（页面 / 校验）只认这一个模块名，
// 内部拆成几个文件是实现细节。
export { buildLayeredArch, buildLayeredSvg };
export type { CrossCall, LayerBandId, LayeredArchData, LayeredBand, LayeredEdge, LayeredGroup };

// ─────────────────────────────────────────────────────────────
// 一、ProjectFacts 的类型（照后端 JSON 形状手写）
//
// 形状漂移必须能被发现：真实扫描输出与这里的字段对不上，调用方会立刻拿到
// `undefined` 而非凭空造的值 —— 编出来的数字会一路传到交付物里，那是最危险的写法。
// ─────────────────────────────────────────────────────────────

export interface FactsEvidence {
  path: string;
  line: number;
}

export interface ProjectFacts {
  schemaVersion: number;
  root: string;
  sourceKind: string;
  scannedAt: string;
  build: {
    artifacts: {
      path: string;
      groupId: string | null;
      artifactId: string | null;
      javaVersion: string | null;
      parent: string | null;
    }[];
    dependencies: {
      group: string;
      artifact: string;
      version: string | null;
      scope: string | null;
      path: string;
      line: number;
    }[];
    plugins: { artifact: string; path: string }[];
    kind: string | null;
    counts: { modules: number; dependencies: number };
  };
  config: { path: string; keys: string[]; values: Record<string, string> }[];
  deploy: {
    dockerfiles: { path: string; baseImages: string[]; exposedPorts: number[] }[];
    compose: { path: string; services: string[] }[];
    k8s: { path: string; kind: string; name: string; replicas: number | null }[];
    helm: { path: string; name: string | null; replicaCount: number | null }[];
    nginx: { path: string; upstreams: string[] }[];
    ci: { path: string; stages: string[]; kind: string }[];
  };
  code: {
    annotations: Record<string, number>;
    layers: Record<string, number>;
    packages: { path: string; files: number }[];
    routes: { method: string; path: string; handler: string; file: string; line: number }[];
    clients: { kind: string; target: string | null; file: string; line: number }[];
    directCalls: { from: string; to: string; file: string }[];
    clientsUnique: { kind: string; target: string | null }[];
  };
  frontend: { kind: string | null; deps: string[]; routes: string[] };
  techStack: {
    matched: {
      tech: string;
      name: string;
      icon?: string;
      dim?: string;
      opt?: string;
      evidence: FactsEvidence[];
    }[];
    unmatched: { group: string; artifact: string; count: number; evidence: FactsEvidence[] }[];
    coverage: number;
    depCount: number;
  };
  stats: { files: number; bytes: number; truncated: boolean; elapsedMs: number };
  notes: { level: string; code: string; message: string }[];
}

// ─────────────────────────────────────────────────────────────
// 二、facts → 选型（纯查表 + 确定性冲突裁决 + 部署声明推导）
// ─────────────────────────────────────────────────────────────

export interface FactsUnmatched {
  /** 技术名（或 group:artifact）。页面上显示给人看 */
  tech: string;
  /** 出处：文件路径:行号，或「同维度冲突，取 X，未取 Y」这类说明 */
  evidence: string;
}

/** 「这次怎么选的」：来源分三类，界面上分开列 */
export interface FactsDetail {
  /** 依赖坐标命中的槽位，每条都带出处文件与行号 */
  fromDeps: { dim: string; opt: string; tech: string; evidence: FactsEvidence }[];
  /** 部署清单推出来的槽位。`because` 一定是仓库里真实存在的那个文件 */
  fromDeploy: { dim: string; opt: string; because: string }[];
  /** 同一维度被多条命中时，谁留下、谁让位 */
  conflicts: { dim: string; kept: string; dropped: string[] }[];
}

export interface FactsToPicksResult {
  picks: StackPicks;
  unmatched: FactsUnmatched[];
  detail: FactsDetail;
}

/** 规则表里的 tech 出现顺序 —— 同维度冲突时按这个顺序取第一条，保证确定性 */
const RULE_ORDER = new Map<string, number>();
SCAN_RULES.forEach((r, i) => {
  if (!RULE_ORDER.has(r.tech)) RULE_ORDER.set(r.tech, i);
});

/** CI 文件类型（后端 `ci.kind`）→ 画布 `cicd` 维度的选项 id */
const CI_OPT: Record<string, string> = {
  'gitlab-ci': 'gitlabci',
  githubactions: 'githubactions',
  jenkins: 'jenkins',
  argocd: 'argocd',
};

/**
 * 部署清单 → 部署相关维度。
 *
 * **只认读到的文件**，取「完整度最高」的那一档，并且把那个文件写进 `because`：
 * 图上有 Helm，是因为仓库里真有 `deploy/helm/demo/Chart.yaml`，
 * 不是因为「有 K8s 清单的项目通常也上 Helm」。
 *
 * 覆盖四个维度：交付形态 `/ deploy`、编排 `/ orchestration`、入口 `/ ingress`、
 * 流水线 `/ cicd`。其余部署类维度（镜像库、集群拓扑）读不出来就留空 ——
 * 留空在下游是「未选择」，比猜一个靠谱。
 */
function deployPicks(facts: ProjectFacts): FactsDetail['fromDeploy'] {
  const out: FactsDetail['fromDeploy'] = [];
  const d = facts.deploy;
  const helm = d?.helm ?? [];
  const k8s = d?.k8s ?? [];
  const compose = d?.compose ?? [];
  const docker = d?.dockerfiles ?? [];
  const nginx = d?.nginx ?? [];
  const ci = d?.ci ?? [];

  /** 同一堆清单里有 Deployment 就优先指向它 —— 带副本数的那个文件信息量最大 */
  const workload = k8s.find((k) => k.kind === 'Deployment') ?? k8s[0];

  if (helm.length) {
    const withCount = helm.find((h) => h.replicaCount !== null) ?? helm[0];
    out.push({ dim: 'deploy', opt: 'helm', because: withCount.path });
  } else if (workload) {
    out.push({ dim: 'deploy', opt: 'k8s', because: workload.path });
  } else if (compose.length) {
    out.push({ dim: 'deploy', opt: 'docker', because: compose[0].path });
  } else if (docker.length) {
    out.push({ dim: 'deploy', opt: 'docker', because: docker[0].path });
  }

  if (workload) {
    out.push({ dim: 'orchestration', opt: 'k8s', because: workload.path });
  } else if (compose.length) {
    out.push({ dim: 'orchestration', opt: 'compose', because: compose[0].path });
  }

  if (nginx.length) {
    out.push({ dim: 'ingress', opt: 'nginx', because: nginx[0].path });
  }

  // 流水线：只认得出类型的那几种。认不出（自研脚本）就不填 —— 填了等于瞎猜
  const ciFile = ci.find((c) => CI_OPT[c.kind]);
  if (ciFile) {
    out.push({ dim: 'cicd', opt: CI_OPT[ciFile.kind], because: ciFile.path });
  }

  return out;
}

/**
 * 事实 → 选型。**这一步是整条链路上唯一「会选东西」的地方**，所以确定性优先：
 *
 *  · 每个 `matched` 项若带 `dim`+`opt`，写进 `picks[dim] = opt`（纯查表）；
 *  · 没有 `dim` 的（工具库 / 编码期依赖）—— 进 unmatched，不许静默丢弃；
 *  · 一个 `dim` 被多条命中 —— 按 `RULE_ORDER` 取第一条写进 picks，
 *    其余写进 conflicts 并说明「同维度冲突，取 X，未取 Y」；
 *  · 部署清单推导的四个维度见 `deployPicks`，**后于依赖命中写入**：
 *    两者撞车时（比如 pom 里的依赖说 docker、Helm 清单说 helm），以清单为准，
 *    让位的那个记进 conflicts。
 */
export function factsToPicks(facts: ProjectFacts): FactsToPicksResult {
  const picks: StackPicks = {};
  const unmatched: FactsUnmatched[] = [];
  const detail: FactsDetail = { fromDeps: [], fromDeploy: [], conflicts: [] };
  const byDim = new Map<string, ProjectFacts['techStack']['matched'][number][]>();

  for (const m of facts.techStack?.matched ?? []) {
    const ev = m.evidence?.[0];
    const evStr = ev ? `${ev.path}:${ev.line}` : '—';
    if (!m.dim || !m.opt) {
      // 认得这项技术，但它不落部署节点位（Maven / Lombok / JUnit 这类）
      unmatched.push({ tech: m.name ?? m.tech, evidence: evStr });
      continue;
    }
    const list = byDim.get(m.dim) ?? [];
    list.push(m);
    byDim.set(m.dim, list);
  }

  for (const dim of [...byDim.keys()].sort()) {
    const list = byDim.get(dim)!;
    // 确定性：规则表里排得靠前的优先（同一条 dim 不可能重复出现在表里，这里按 tech 顺序）
    const ordered = [...list].sort(
      (a, b) =>
        (RULE_ORDER.get(a.tech) ?? Number.MAX_SAFE_INTEGER) -
        (RULE_ORDER.get(b.tech) ?? Number.MAX_SAFE_INTEGER)
    );
    const [kept, ...rest] = ordered;
    picks[dim] = kept.opt!;
    const keptName = kept.name ?? kept.tech;
    detail.fromDeps.push({
      dim,
      opt: kept.opt!,
      tech: kept.tech,
      evidence: kept.evidence?.[0] ?? { path: '—', line: 0 },
    });
    for (const r of rest) {
      const droppedName = r.name ?? r.tech;
      const conflict = detail.conflicts.find((c) => c.dim === dim);
      if (conflict) conflict.dropped.push(droppedName);
      else detail.conflicts.push({ dim, kept: keptName, dropped: [droppedName] });
      unmatched.push({
        tech: droppedName,
        evidence: `同维度冲突（${dim}），取 ${keptName}，未取 ${droppedName}`,
      });
    }
  }

  // ── 部署清单：覆盖依赖推不出来的那四个维度 ──
  for (const d of deployPicks(facts)) {
    const prev = picks[d.dim];
    if (prev === d.opt) continue;
    if (prev === undefined) {
      picks[d.dim] = d.opt;
    } else {
      // 依赖说一套、清单说另一套：清单赢（它才是实际怎么跑），但要留痕
      const conflict = detail.conflicts.find((c) => c.dim === d.dim);
      if (conflict) conflict.dropped.push(prev);
      else detail.conflicts.push({ dim: d.dim, kept: d.opt, dropped: [prev] });
      picks[d.dim] = d.opt;
    }
    detail.fromDeploy.push(d);
  }

  // 后端没认出来的依赖坐标（group:artifact 不在映射表里）
  for (const u of facts.techStack?.unmatched ?? []) {
    const ev = u.evidence?.[0];
    unmatched.push({
      tech: `${u.group}:${u.artifact}`,
      evidence: ev ? `${ev.path}:${ev.line}` : `出现 ${u.count} 次，未收录映射`,
    });
  }

  return { picks, unmatched, detail };
}

// ─────────────────────────────────────────────────────────────
// 三、链路 ①：facts → 部署架构图
// ─────────────────────────────────────────────────────────────

export interface FactsTechArch {
  /** 部署模型。交给 `buildTechArchSvg` 就是一张交付级 SVG */
  arch: TechArch;
  picks: StackPicks;
  unmatched: FactsUnmatched[];
  detail: FactsDetail;
  /** 图上做过的自动决定，界面上原样列出来（含副本数出处） */
  notes: string[];
}

export interface ReplicaFact {
  replicas: number;
  path: string;
  source: string;
}

/**
 * 从部署清单里读副本数。**优先 K8s Deployment**（它就是这个工作负载的副本声明），
 * 读不到再看 Helm `replicaCount`。两处都没有 → null，调用方不许兜底成 1。
 */
export function replicaFact(facts: ProjectFacts): ReplicaFact | null {
  const k8s = (facts.deploy?.k8s ?? []).filter(
    (k) => k.kind === 'Deployment' && typeof k.replicas === 'number'
  );
  if (k8s.length) {
    return { replicas: k8s[0].replicas as number, path: k8s[0].path, source: 'K8s Deployment' };
  }
  const helm = (facts.deploy?.helm ?? []).filter(
    (h) => typeof h.replicaCount === 'number'
  );
  if (helm.length) {
    return {
      replicas: helm[0].replicaCount as number,
      path: helm[0].path,
      source: 'Helm replicaCount',
    };
  }
  return null;
}

/**
 * 把副本数事实落到应用节点上。
 *
 * 为什么只改**应用卡**：K8s 里的 `replicas` 属于「这个工作负载」，
 * 不属于「这个组件类型」。Redis 的副本数该由 Redis 自己的集群形态声明，
 * 拿应用的 3 去覆盖它，图上会写出「Redis ×3」这种没有依据的数字。
 *
 * 返回新模型（不改传入对象）—— 纯函数便于「出两次结果必须逐字段相等」的断言。
 */
export function applyReplicaFacts(
  arch: TechArch,
  facts: ProjectFacts
): { arch: TechArch; notes: string[] } {
  const fact = replicaFact(facts);
  const notes: string[] = [];
  if (!fact) {
    notes.push(
      '部署清单里没有声明副本数（K8s replicas / Helm replicaCount 都没有）—— 图上不画副本数徽章，不默认 1'
    );
    return { arch, notes };
  }

  // 两份清单都声明过、数字还不一样：两个都写出来，别挑一个当好话
  const helmCount = (facts.deploy?.helm ?? []).find(
    (h) => typeof h.replicaCount === 'number'
  );
  if (
    helmCount &&
    fact.source === 'K8s Deployment' &&
    helmCount.replicaCount !== fact.replicas
  ) {
    notes.push(
      `副本数两处不一致：${fact.path} 说 ${fact.replicas}，${helmCount.path} 说 ${helmCount.replicaCount} —— 图上取前者（K8s 清单才是最终生效的）`
    );
  }

  const nodes = arch.nodes.map((n) => {
    if (n.kind !== 'app') return n;
    return {
      ...n,
      modes: [{ name: `${fact.source} 声明`, replicas: fact.replicas, note: fact.path }],
      mode: 0,
    };
  });

  notes.push(`副本数 ${fact.replicas} 取自 ${fact.path}（${fact.source} 声明）`);
  return { arch: { ...arch, nodes }, notes };
}

/**
 * facts → 部署架构模型。**只调用 `buildTechArch` 与 `applyReplicaFacts`，不改它们**。
 */
export function buildTechArchFromFacts(
  facts: ProjectFacts,
  edits: CanvasEdits = emptyEdits()
): FactsTechArch {
  const { picks, unmatched, detail } = factsToPicks(facts);
  const base = buildTechArch(picks, edits);
  const { arch, notes } = applyReplicaFacts(base, facts);
  const notes2 = [...notes];

  for (const d of detail.fromDeps) {
    if (d.evidence.line > 0) continue;
    notes2.push(`${d.dim}=${d.opt}（${d.tech}）没有行号出处 —— 映射表命中但证据行缺失`);
  }

  return { arch, picks, unmatched, detail, notes: notes2 };
}

// ─────────────────────────────────────────────────────────────
// 四、链路 ③：facts → Archify IR → 现有出图服务
// ─────────────────────────────────────────────────────────────

export type ArchifyPreset = NonNullable<ArchifyIrOptions['visualPreset']>;

/**
 * 画面主题 → 出图服务的视觉预设。
 *
 * 两套配色体系是各自演进出来的（本地 SVG 五套主题 / 后端四个 preset），
 * 这里只做一次**显式**映射：不写这张表，就会出现「选了文档主题、导出的 HTML 还是蓝图」。
 */
export function presetForTheme(theme: CanvasTheme | undefined): ArchifyPreset {
  switch (theme) {
    case 'doc':
      return 'editorial';
    case 'slide':
      return 'signal-flow';
    case 'light':
      return 'classic';
    default:
      // dark 与 blueprint 都是深色工程图，落到同一个 preset 是相容的
      return 'blueprint';
  }
}

export interface FactsIrResult {
  ir: ArchifyIr;
  preset: ArchifyPreset;
  title: string;
}

/**
 * facts → 交付级 IR。**只调用 `buildArchifyIr`，不改它**。
 *
 * 产出的 IR 可直接 `POST /api/archify/deliver`。出去前由调用方过
 * `archifyIrShapeIssues()` + `archifyIrIssues()` 两道本地预检 ——
 * 不预检就发，形状不对时报错会指向我们的代码行，而图上什么都看不出来。
 */
export function buildArchifyIrFromFacts(
  facts: ProjectFacts,
  opts: { theme?: CanvasTheme; title?: string; subtitle?: string } = {}
): FactsIrResult {
  const built = buildTechArchFromFacts(facts);
  const preset = presetForTheme(opts.theme);
  const title = opts.title ?? `${facts.root} 技术架构图`;
  const ir = buildArchifyIr(built.arch, {
    title,
    subtitle: opts.subtitle,
    locale: 'zh-CN',
    visualPreset: preset,
  });
  return { ir, preset, title };
}

// ─────────────────────────────────────────────────────────────
// 五、摘要（界面上的 chip 云与「未识别」清单都读这里）
// ─────────────────────────────────────────────────────────────

export interface FactsSummary {
  root: string;
  sourceKind: string;
  files: number;
  bytes: number;
  truncated: boolean;
  elapsedMs: number;
  buildKind: string | null;
  javaVersion: string | null;
  techs: { tech: string; name: string; icon?: string; dim?: string; onCanvas: boolean }[];
  onCanvasCount: number;
  unmatched: { group: string; artifact: string; count: number; where: string }[];
  coverage: number;
  controllerCount: number | null;
  serviceCount: number | null;
  repositoryCount: number | null;
}

/** 给界面用的摘要：技术命中（按 dim 判断会不会上部署图）+ 未收录依赖清单。 */
export function summarizeFacts(facts: ProjectFacts): FactsSummary {
  const techs = (facts.techStack?.matched ?? []).map((m) => ({
    tech: m.tech,
    name: m.name,
    icon: m.icon,
    dim: m.dim,
    onCanvas: Boolean(m.dim),
  }));
  return {
    root: facts.root,
    sourceKind: facts.sourceKind,
    files: facts.stats?.files ?? 0,
    bytes: facts.stats?.bytes ?? 0,
    truncated: Boolean(facts.stats?.truncated),
    elapsedMs: facts.stats?.elapsedMs ?? 0,
    buildKind: facts.build?.kind ?? null,
    javaVersion: facts.build?.artifacts?.find((a) => a.javaVersion)?.javaVersion ?? null,
    techs,
    onCanvasCount: techs.filter((t) => t.onCanvas).length,
    unmatched: (facts.techStack?.unmatched ?? []).map((u) => ({
      group: u.group,
      artifact: u.artifact,
      count: u.count,
      where: u.evidence?.[0] ? `${u.evidence[0].path}:${u.evidence[0].line}` : '—',
    })),
    coverage: facts.techStack?.coverage ?? 0,
    controllerCount: totals(facts.code?.layers, 'controller'),
    serviceCount: totals(facts.code?.layers, 'service'),
    repositoryCount: totals(facts.code?.layers, 'repository'),
  };
}

function totals(layers: Record<string, number> | undefined, key: string): number | null {
  if (!layers) return null;
  return key in layers ? layers[key] : 0;
}
