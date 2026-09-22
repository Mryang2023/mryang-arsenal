/**
 * 从代码事实生成**项目档案草稿**（`/arch` 六视图的输入）。
 *
 * ── 这份草稿的定位 ────────────────────────────────────────────
 * 六视图档案（`arsenal-profiles/<id>.json`）里大部分是**人写的话**：
 * 「这件事为谁解决什么问题」「刻意不做什么」—— 这些话代码里没有，扫不出来。
 * 所以这里不假装能生成一份成品档案，只做一件实在的事：
 *
 *   **把扫描真的读到的部分填进去，读不到的留 `TODO` 占位，并逐条列出来。**
 *
 * 好处有两个：① 人拿到的是一个填好一半的骨架，接着写就行；
 * ② 「哪些是扫出来的、哪些是人补的」在文件里一目了然 ——
 * 一份分不清这两者的档案，读的人会把 TODO 当成事实。
 *
 * ── 一条必须守住的线 ─────────────────────────────────────────
 * 数字全部来自 facts，**没有一个是我们估的**。外部项目的数字平台算不出来，
 * 所以这里不写 `{{token}}`（那是军火库自己的度量）—— 这是这套 token 机制
 * 唯一被允许的例外，理由是「平台无法计算它」。
 */

import { archProfileShapeIssues, type ArchProfile, type ArchViewId } from './arch-profile';
import {
  buildLayeredArch,
  buildTechArchFromFacts,
  summarizeFacts,
  type FactsSummary,
  type ProjectFacts,
} from './facts-arch';

/** 需要人补的地方统一带这个前缀，扫一眼就知道哪些不是事实 */
const TODO = 'TODO ';

export interface ProfileDraft {
  profile: ArchProfile;
  /** 全部 TODO 条目（按出现顺序）。导入界面上要直接列出来 */
  todos: string[];
  /** 从事实里填进去的条目数（真数据），与 todos.length 一起说明草稿的成熟度 */
  filled: number;
  /** 草稿自身的形状问题。空数组即过 `archProfileShapeIssues` */
  issues: string[];
}

function slug(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'imported-project';
}

/**
 * 集群形态的文字。
 *
 * `undefined` 不是「单实例」，是「扫描没读到」—— 写「单实例」等于替对方断言
 * 它的部署形态，读的人会当真。`1` 才是单实例（那是声明出来的数字）。
 */
function modeLabel(replicas: number | undefined): string {
  if (replicas === undefined || replicas === null) return '副本数未声明';
  return replicas <= 1 ? '单实例（声明 1）' : `${replicas} 个实例`;
}

export function buildProfileDraftFromFacts(facts: ProjectFacts): ProfileDraft {
  const sum: FactsSummary = summarizeFacts(facts);
  const built = buildTechArchFromFacts(facts);
  const layered = buildLayeredArch(facts, built.arch);

  const techNames = sum.techs.map((t) => t.name);
  const apiRoutes = facts.code?.routes ?? [];
  const feRoutes = facts.frontend?.routes ?? [];
  const layers = facts.code?.layers ?? {};
  const clients = facts.code?.clientsUnique ?? [];
  const packages = facts.code?.packages ?? [];
  const stages = [...new Set((facts.deploy?.ci ?? []).flatMap((c) => c.stages))];
  const storageNodes = built.arch.nodes.filter((n) => n.zone === 'data' && n.kind !== 'app');
  const mwNodes = built.arch.nodes.filter((n) => n.zone === 'mw' || n.zone === 'ops');
  const platformNodes = built.arch.nodes.filter((n) => n.zone === 'platform');

  // ── 业务架构：这一块扫描**基本读不到**，如实留 TODO ──
  const consumers =
    clients.length > 0
      ? clients.map((c) => (c.target ? `${c.target}（${c.kind} 调用）` : `${c.kind} 调用`))
      : [];

  // ── 数据架构 ──
  const assets = storageNodes.map((n) => ({
    path: n.id,
    name: n.title,
    metric: modeLabel(n.modes?.[n.mode ?? 0]?.replicas),
    desc: n.subtitle,
  }));
  const pipeline = stages.map((s) => ({ name: s, desc: 'CI stage（来自流水线配置）' }));
  const migrationTech = sum.techs.find((t) => t.dim === 'migration');

  // ── 应用架构 ──
  const pageRoutes =
    feRoutes.length > 0
      ? feRoutes.map((r) => ({
          path: r,
          name: r === '/' ? '首页' : r.replace(/^\//, ''),
          desc: '前端页面路由（来自前端目录结构）',
        }))
      : [];
  const routeRows =
    pageRoutes.length > 0
      ? pageRoutes
      : apiRoutes.map((r) => ({
          path: r.path || '/',
          name: r.handler,
          desc: `接口路径（扫描没有发现前端页面，这一行是 ${r.method} 接口）`,
        }));

  const endpointGroups = (() => {
    const byMethod = new Map<string, string[]>();
    for (const r of apiRoutes) {
      const list = byMethod.get(r.method) ?? [];
      list.push(`${r.path || '/'} → ${r.handler}（${r.file}:${r.line}）`);
      byMethod.set(r.method, list);
    }
    return [...byMethod.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([group, items]) => ({ group, items }));
  })();

  // 每一带的条目取「代码单元」那些（infra 是它连出去的对象，不属于应用分层）
  const layerRows = layered.bands
    .filter((b) => b.id !== 'client')
    .map((b) => ({
      name: b.name,
      desc: b.desc,
      items:
        b.groups
          .filter((g) => !g.infra && g.count !== null)
          .map((g) => `${g.label} × ${g.count}`)
          .join(' / ') || '—',
    }));

  const contracts = [
    ...clients.map((c) => `对外调用：${c.target ?? c.kind}（${c.kind}）`),
    ...(['@Transactional', '@Cacheable', '@KafkaListener'] as const)
      .filter((a) => (facts.code?.annotations ?? {})[a])
      .map((a) => `${a} × ${facts.code.annotations[a]}`),
  ];
  if (layered.crossCalls.length) {
    contracts.push(
      ...layered.crossCalls.map(
        (c) => `需要收口：${c.fromClass} 直接持有 ${c.toClass}（${c.file}）`
      )
    );
  }

  // ── 产品架构 ──
  const surfaces =
    pageRoutes.length > 0
      ? pageRoutes.map((r) => ({ name: r.name, desc: r.path }))
      : [];

  const layerStatus = (['controller', 'service', 'repository', 'domain', 'config'] as const)
    .filter((k) => (layers[k] ?? 0) > 0)
    .map((k) => ({
      name: k,
      status: 'done' as const,
      metric: `${layers[k]} 个类`,
      desc: '由代码扫描得到',
    }));

  // ── 项目架构 ──
  const dirs = packages.map((p) => ({ path: p.path, role: `${p.files} 个文件` }));
  const verifyChain = [
    { name: 'Java 源文件', count: layersTotal(layers), desc: '扫描统计（不是 verify 项数）' },
    { name: '配置文件', count: (facts.config ?? []).length, desc: 'yml / properties / .env' },
    {
      name: '部署清单',
      count:
        (facts.deploy?.k8s ?? []).length +
        (facts.deploy?.helm ?? []).length +
        (facts.deploy?.compose ?? []).length +
        (facts.deploy?.dockerfiles ?? []).length +
        (facts.deploy?.nginx ?? []).length,
      desc: 'Dockerfile / compose / K8s / Helm / nginx',
    },
    { name: 'CI 配置', count: (facts.deploy?.ci ?? []).length, desc: '流水线文件' },
  ].filter((s) => s.count > 0);

  const profile: ArchProfile = {
    id: slug(facts.root),
    name: `${facts.root}（扫描草稿）`,
    subtitle: `${facts.sourceKind} · ${sum.files} 个文件 · ${sum.techs.length} 项技术命中 · 扫描于 ${facts.scannedAt}`,
    note:
      '这份档案由代码扫描生成，**只是骨架**：带「' +
      TODO +
      '」前缀的条目是扫描读不到的东西（业务定位、消费方、非目标、路线图），需要人补。\n' +
      '数字全部来自扫描事实，没有一个是估的。补完后放进 arsenal-profiles/<id>.json 再跑 sync:content，\n' +
      '它才会成为 `/arch` 里可切换的正式档案 —— 导入到本机浏览器的档案不进仓库。',
    views: buildViews({
      techNames,
      storageNames: assets.map((a) => a.name),
      layerNames: layerRows.map((l) => l.name),
      dirCount: dirs.length,
      routeCount: routeRows.length,
      platformNames: platformNodes.map((n) => n.title),
      mwNames: mwNodes.map((n) => n.title),
    }),
    business: {
      domains: [
        {
          name: `${routeRows.length} 个路由入口`,
          desc: '由代码扫描得到。业务域划分需要人补 —— 代码里没有「业务域」这个概念',
        },
      ],
      outlets: [{ name: `${TODO}产品出口`, desc: '扫描读不到：这个系统对外的出口分别是什么' }],
      consumers: consumers.length ? consumers : [`${TODO}消费方`],
      nonGoals: [`${TODO}刻意不做的事`, `${TODO}规模与边界（单人？团队？）`],
    },
    data: {
      assets: assets.length
        ? assets
        : [{ path: 'unknown', name: `${TODO}数据资产`, metric: '—', desc: '扫描没有发现数据存储节点' }],
      pipeline: pipeline.length ? pipeline : [{ name: `${TODO}数据流`, desc: '扫描读不到数据流向' }],
      consumers: [`${TODO}数据消费方`],
      governance: migrationTech
        ? [`Schema 迁移：${migrationTech.name}`]
        : [`${TODO}数据治理（迁移 / 备份 / 权限）`],
    },
    app: {
      routes: routeRows.length ? routeRows : [{ path: '/', name: `${TODO}路由`, desc: '' }],
      endpoints: endpointGroups.length ? endpointGroups : [{ group: TODO.trim(), items: ['—'] }],
      layers: layerRows.length ? layerRows : [{ name: `${TODO}分层`, desc: '', items: '—' }],
      contracts: contracts.length ? contracts : [`${TODO}接口契约`],
    },
    product: {
      surfaces: surfaces.length ? surfaces : [{ name: `${TODO}产品面`, desc: '扫描读不到产品形态' }],
      engineLayers: layerStatus.length ? layerStatus : [{ name: TODO.trim(), status: 'todo' as const, metric: '—', desc: '' }],
    },
    project: {
      dirs: dirs.length ? dirs : [{ path: '—', role: `${TODO}目录结构` }],
      pipeline: [
        `扫描：${facts.sourceKind}`,
        `技术命中：${sum.techs.length} 项（${sum.onCanvasCount} 项落部署图）`,
        ...stages.map((s) => `CI stage：${s}`),
      ],
      verifyChain: verifyChain.length ? verifyChain : [{ name: '扫描文件', count: Math.max(1, sum.files), desc: '' }],
      roadmap: [
        { name: `${TODO}下一步`, desc: '这份草稿的路线图需要人补', tone: 'next' as const },
      ],
    },
  };

  return {
    profile,
    // 待补清单**从最终档案反扫出来**，不靠分支里各自 push ——
    // 分支 push 漏一处，卡片上「0 条待补」就与文件里明晃晃的 TODO 自相矛盾。
    todos: collectTodos(profile),
    filled: countFilled(profile),
    issues: archProfileShapeIssues(profile),
  };
}

/** 分层里各类的合计（Java 源文件数的一个下界：只算被识别出分层的类） */
function layersTotal(layers: Record<string, number>): number {
  return Object.values(layers).reduce((n, v) => n + v, 0);
}

/**
 * 六视图文案。能推的推，推不出的留 TODO —— focus 必须非空（形状校验要求），
 * 所以 TODO 本身也要成为一条焦点，不能空着糊过去。
 */
function buildViews(ctx: {
  techNames: string[];
  storageNames: string[];
  layerNames: string[];
  dirCount: number;
  routeCount: number;
  platformNames: string[];
  mwNames: string[];
}): ArchProfile['views'] {
  const t = (list: string[], fallback: string): string[] => (list.length ? list : [fallback]);
  const views: Record<ArchViewId, ArchProfile['views'][ArchViewId]> = {
    business: {
      definition: `${TODO}这个系统为谁解决什么问题`,
      focus: [`${TODO}核心业务域`, `${TODO}关键角色`],
      question: '这件事不做会怎样？',
      outputs: [`${TODO}业务能力清单`, `${TODO}领域划分`],
    },
    data: {
      definition: `代码扫描到的数据存储与流向：${t(ctx.storageNames, '未发现存储节点').join('、')}`,
      focus: t(ctx.storageNames, `${TODO}数据资产`),
      question: '哪些数据是权威源？谁在写、谁在读？',
      outputs: ['数据资产表', `${TODO}数据流图`, `${TODO}治理策略`],
    },
    app: {
      definition: `代码里的分层与接口：${ctx.layerNames.join(' / ')}，共 ${ctx.routeCount} 个路由入口`,
      focus: t(ctx.layerNames, `${TODO}分层`),
      question: '调用方向有没有被跳过？跨带直连有几处？',
      outputs: ['应用分层图', '接口清单', '分层违规清单'],
    },
    tech: {
      definition: `扫描出的技术栈：${t(ctx.techNames, '未命中任何已知技术').join('、')}`,
      focus: t(ctx.techNames, `${TODO}技术栈`),
      question: '部署出来是什么样？哪些是构建期的、不上图？',
      outputs: ['部署架构图', '交付级 HTML', '技术选型清单'],
    },
    product: {
      definition: `${TODO}产品形态与引擎分层`,
      focus: [`${TODO}产品面`, `${TODO}引擎能力`],
      question: '用户看到的是什么？引擎分了几层？',
      outputs: [`${TODO}产品面清单`, `${TODO}引擎分层与状态`],
    },
    project: {
      definition: `工程结构：${ctx.dirCount} 个包路径，交付形态 ${t(ctx.platformNames, '未声明').join('、')}`,
      focus: t([...ctx.platformNames, ...ctx.mwNames], `${TODO}交付形态`),
      question: '怎么跑起来？怎么验证？下一步做什么？',
      outputs: ['目录职责表', '流水线', '路线图'],
    },
  };
  return views;
}

/**
 * 反扫档案里所有带 `TODO ` 前缀的条目，连它所在的位置一起给出。
 *
 * 位置（`views.business.outlets[0]`）比正文更有用：打开文件的人靠它直接定位。
 */
function collectTodos(profile: ArchProfile): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if (v.startsWith(TODO)) out.push(`${path}：${v.slice(TODO.length)}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      Object.entries(v as Record<string, unknown>).forEach(([k, val]) => {
        // note / subtitle 是写给人看的使用说明，允许引述「TODO 」这个前缀本身
        if (k === 'note' || k === 'subtitle') return;
        walk(val, path ? `${path}.${k}` : k);
      });
    }
  };
  const { views, ...rest } = profile;
  walk(views, 'views');
  walk(rest, '');
  return out;
}

/** 数一数草稿里有多少条是真数据（不带 TODO 前缀） */
function countFilled(profile: ArchProfile): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (!v.startsWith(TODO) && v.trim() && v !== '—') n += 1;
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.entries(v as Record<string, unknown>).forEach(([k, val]) => {
        if (k === 'note' || k === 'subtitle') return;
        walk(val);
      });
    }
  };
  const { views, ...rest } = profile;
  walk(views);
  walk(rest);
  return n;
}
