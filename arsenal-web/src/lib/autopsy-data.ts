/**
 * 解剖台数据层 —— 「一份 ProjectFacts → 一批结论」的**唯一出处**。
 *
 * 为什么抽出来：这条链路原本写在 `components/CodeIntake.tsx` 的 `useMemo` 里，
 * 只有「从代码生成」那一个折叠面板能用。解剖台（`/autopsy`）要的是同一批结论，
 * 抄一份就变成「CodeIntake 一份、AutopsyLab 一份」—— 两份功能等价但形态不同的
 * 通道可以各自漂移，而两边都全绿（本仓 memory 铁律 23）。所以把**纯数据部分**抽到这儿，
 * 两个消费方都调它，UI 各自画。
 *
 * 三条规矩：
 *   ① **纯函数**：不读时钟、不读 DOM、不发请求。同输入必同输出 ——
 *      「扫两次结果必须逐字段相等」这类断言依赖这一点。
 *   ② **不新增知识**：本文件只做「翻译与组装」，判据在 `facts-arch.ts`（查表）
 *      与后端 `com.arsenal.scan`（读事实）。这里出现任何「大概是」的推断都是越权。
 *   ③ **没读到的就是没有**：证据缺失时给出「无 evidence」的字样，不许编一个路径出来。
 */
import { buildTechArchSvg, type CanvasTheme } from '@/lib/arch-canvas';
import { archifyIrIssues, archifyIrShapeIssues, type ArchifyIr } from '@/lib/archify-ir';
import {
  buildArchifyIrFromFacts,
  buildLayeredArch,
  buildLayeredSvg,
  buildTechArchFromFacts,
  factsToPicks,
  summarizeFacts,
  type FactsSummary,
  type FactsTechArch,
  type FactsToPicksResult,
  type LayeredArchData,
  type ProjectFacts,
} from '@/lib/facts-arch';
import { buildCodeStructure, type CodeStructure } from '@/lib/code-structure';
import { scanStats } from '@/lib/scan-rules';
import type { PicksProvenance } from '@/lib/picks-store';
import { buildServiceGraphSvg } from '@/lib/service-graph';
import { buildServiceTopo, type ServiceTopo } from '@/lib/service-topo';

/** 一次解剖的全部派生结论。界面拿它渲染，不许自己再算一遍 */
export interface AutopsyArtifacts {
  facts: ProjectFacts;
  /** 选型结果（含「这次怎么选的」明细） */
  picksRes: FactsToPicksResult;
  /** 部署图模型 + 图上做过的自动决定 */
  built: FactsTechArch;
  /** 应用分层模型 */
  layered: LayeredArchData;
  layeredSvg: string;
  summary: FactsSummary;
  techSvg: string;
  /** 服务拓扑模型（「这个项目有几个服务」—— 每条声明带出处，见 service-topo.ts） */
  topo: ServiceTopo;
  /** 服务调用图 SVG（无证据不画边；空边集时图上明说） */
  topoSvg: string;
  /** 交付级 IR（交给 /api/archify 出 HTML 用） */
  ir: ArchifyIr;
  /** IR 形状问题（形状不对时构图诊断没有意义，所以分开） */
  shape: string[];
  issues: string[];
  title: string;
  /** 选型出处：装配台靠它区分「扫描读出来的格子」与「人点出来的格子」 */
  provenance: PicksProvenance;
  /** 项目结构：目录树 + 类角色徽标 + 层级释义（纯函数产物，面板只画） */
  structure: CodeStructure;
}

/**
 * 调用图的标题与副标题。
 *
 * 单独导出是因为 `scan-check.ts` 的 9-1b 要「与 facts 直算逐字节比对」——
 * 比对时必须传同一份 opts，否则标题差一个字就红，而红的原因跟判据无关。
 * 放在这里（而不是各写一份）是为了让「产物用的 opts」与「比对用的 opts」
 * 永远不可能对不上。
 */
export function serviceGraphOpts(
  facts: ProjectFacts,
  topo: ServiceTopo
): { title: string; subtitle: string; subtitle2?: string } {
  // 副标题分行：结论在上、三源明细在下。有外部目标时必须走两行 ——
  // 单行塞下「识别/声明/调用边/外部目标」在 456px 窄图上实测放不下（Edge 里
  // 全角按 1em、半角约 0.6em，估算系数偏小直接被画布切掉半句，2026-10-12 实测）。
  const decl =
    `声明 ${facts.services?.declarations?.length ?? 0} 条` +
    `（compose ${topo.counts.compose} / k8s 工作负载 ${topo.counts.k8sWorkload} / 代码入口 ${topo.counts.codeEntry}）`;
  const edges = `调用边 ${topo.counts.edges} 条`;
  if (topo.counts.externals === 0) {
    // 没有外部目标：保持旧口径单行（少一行副标题，图更矮，既有字节不变）
    return {
      title: `${facts.root} 服务调用图`,
      subtitle: `识别 ${topo.counts.units} 个服务单元 · ${decl} · ${edges}`,
    };
  }
  return {
    title: `${facts.root} 服务调用图`,
    subtitle: `识别 ${topo.counts.units} 个服务单元 · ${edges} · 外部目标 ${topo.counts.externals} 个（声明之外）`,
    subtitle2: decl,
  };
}

/**
 * facts → 全部派生结论。
 *
 * 与抽出来之前的行为逐字段一致 —— 这是 `/archify` + `/arch` 回归不红的依据
 * （校验层 `.verify` 里「同一份 facts 出两次必须相等」的断言也走这条）。
 */
export function buildAutopsy(facts: ProjectFacts, theme: CanvasTheme = 'doc'): AutopsyArtifacts {
  const picksRes = factsToPicks(facts);
  const built = buildTechArchFromFacts(facts);
  // 分层图与部署图共用同一个模型入口：数据存储那一带取的就是部署图上的节点，
  // 两张图因此不会一个说 MySQL 一个说 Postgres
  const layered = buildLayeredArch(facts, built.arch);
  const summary = summarizeFacts(facts);
  const title = `${facts.root} 技术架构图`;
  const techSvg = buildTechArchSvg(built.arch, theme, {
    title,
    subtitle:
      `由代码扫描生成 · ${summary.files} 个文件 / ${built.arch.nodes.length} 个节点 / ` +
      `${built.arch.edges.length} 条连线 · ${summary.techs.length} 项技术命中`,
  });
  const layeredSvg = buildLayeredSvg(layered, theme);
  // 服务拓扑：模型与图都在纯函数层（service-topo / service-graph），
  // 与 techSvg / layeredSvg 同款 —— 面板只画，不重算
  const topo = buildServiceTopo(facts);
  const topoSvg = buildServiceGraphSvg(topo, theme, serviceGraphOpts(facts, topo));
  // IR 与主题绑定：主题不只是本地配色，它同时决定后端出图用哪套版式，
  // 否则会出现「这里看是文档风、导出的 HTML 还是蓝图」
  const irRes = buildArchifyIrFromFacts(facts, { theme, title });
  const ir = irRes.ir;
  const shape = archifyIrShapeIssues(ir);
  const issues = shape.length ? [] : archifyIrIssues(ir);
  /**
   * 选型出处：`atScan` 存的是**此刻这一份** picks —— 装配台拿它跟用户后来的改动比对，
   * 于是「哪几格是我自己改的」是当场算出来的，不靠谁记性好。
   */
  const provenance: PicksProvenance = {
    kind: 'scan',
    root: facts.root,
    scannedAt: facts.scannedAt ?? '',
    fromDeps: built.detail.fromDeps.map((d) => ({
      dim: d.dim,
      opt: d.opt,
      tech: d.tech,
      path: d.evidence.path,
      line: d.evidence.line,
    })),
    fromDeploy: built.detail.fromDeploy.map((d) => ({
      dim: d.dim,
      opt: d.opt,
      because: d.because,
    })),
    conflicts: built.detail.conflicts.map((c) => ({
      dim: c.dim,
      kept: c.kept,
      dropped: c.dropped,
    })),
    // 后端没认出来的依赖坐标条数 —— 明细留在本页，装配台只报个数
    unmatchedCount: (facts.techStack?.unmatched ?? []).length,
    atScan: { ...picksRes.picks },
  };

  return {
    facts,
    picksRes,
    built,
    layered,
    layeredSvg,
    summary,
    techSvg,
    topo,
    topoSvg,
    ir,
    shape,
    issues,
    title,
    provenance,
    // 项目结构：目录树 + 类角色徽标 + 层级释义（2026-10-17 结构面板棒2）。
    // 与 built / layered / topo 同款 —— 面板只画，不重算
    structure: buildCodeStructure(facts),
  };
}

// ─────────────────────────────────────────────────────────────
// 未识别依赖（解剖台面板三）
//
// 与 `factsToPicks().unmatched` 不是一回事：那一份是「选型视角」的杂项
// （含同维度冲突被放弃的、有 dim 但没上图的），这一份是**后端映射表真没认出来的
// 依赖坐标**，每条带它在哪儿出现过 —— 它是「补映射表」的工作清单。
// ─────────────────────────────────────────────────────────────

export interface AutopsyUnmatched {
  /** `group:artifact`，页面上显示给人看 */
  coord: string;
  group: string;
  artifact: string;
  /** 这个坐标在仓库里出现过几次（同一坐标可能出现在多个模块） */
  count: number;
  /** 证据：文件路径 + 行号。空数组 = 后端没给出处，页面上必须明说，不许省略 */
  evidence: { path: string; line: number }[];
}

export function autopsyUnmatched(facts: ProjectFacts): AutopsyUnmatched[] {
  return (facts.techStack?.unmatched ?? []).map((u) => ({
    coord: `${u.group}:${u.artifact}`,
    group: u.group,
    artifact: u.artifact,
    count: u.count ?? 0,
    evidence: (u.evidence ?? []).filter((e) => e && typeof e.path === 'string'),
  }));
}

/** 依赖识别覆盖情况。分母/分子都从 facts 读，写死会在映射表更新那天开始撒谎 */
export interface AutopsyCoverage {
  depCount: number;
  matchedCoords: number;
  unmatchedCoords: number;
  /** 0–1，facts 没给就 0 —— 「0%」和「没读到」在页面上要分开说 */
  coverage: number;
  /** 映射表规模（rules 条数 / 上画布条数），从同步产物读 */
  ruleCount: number;
  ruleOnCanvas: number;
}

export function autopsyCoverage(facts: ProjectFacts): AutopsyCoverage {
  const matched = facts.techStack?.matched ?? [];
  // 映射表规模从同步产物算（`scanStats()` 读 src/generated/scan_rules.json）——
  // 写死 108 / 47 会在补映射那天开始撒谎，而那天没有任何东西会报错。
  const stats = scanStats();
  return {
    depCount: facts.techStack?.depCount ?? 0,
    matchedCoords: new Set(matched.map((m) => m.tech)).size,
    unmatchedCoords: (facts.techStack?.unmatched ?? []).length,
    coverage: facts.techStack?.coverage ?? 0,
    ruleCount: stats.count,
    ruleOnCanvas: stats.onCanvas,
  };
}

/**
 * 「输入了什么」与「实际扫的是哪儿」的对照。
 *
 * 后端 `SourceResolver.fromPath` 会 `toRealPath()`：相对路径、`.`/`..`、符号链接
 * 都会被解析成**另一个**绝对路径。事实 JSON 里只带目录名（`rootName`），
 * 不落绝对路径（既泄隐私又不可复现）—— 于是「我填的是 A、它扫的是 B」这种事
 * 后端不会报错，页面上不对照就永远看不出来。这条是解剖台新暴露面的守门项。
 */
export interface AutopsySourceTrace {
  /** 用户填进去的原样字符串 */
  requested: string;
  /** 后端事实里的目录名（解析后的真实目录的最后一段） */
  scannedRoot: string;
  /** 二者末段不同 → 解析到了别处，必须显式提示 */
  diverged: boolean;
  kind: string;
}

export function traceSource(requested: string, facts: ProjectFacts): AutopsySourceTrace {
  const scannedRoot = facts.root ?? '';
  const lastOf = (s: string) => {
    const t = s.replace(/[\\/]+$/, '');
    const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
    return i < 0 ? t : t.slice(i + 1);
  };
  const a = lastOf(requested.trim()).toLowerCase();
  const b = lastOf(scannedRoot).toLowerCase();
  return {
    requested,
    scannedRoot,
    // zip 那条路后端会剥掉顶层目录，末段天然不同 —— 不算「解析到别处」
    diverged: Boolean(a && b && a !== b && facts.sourceKind !== 'zip'),
    kind: facts.sourceKind ?? '',
  };
}
