/**
 * 功能视图 —— 「这个项目里都有哪些功能，剥掉一个功能要动多少类」的**唯一算法出处**。
 *
 * ─────────────────────────────────────────────────────────────
 * 它回答的是三个问题，顺序固定：
 *
 *   ① **功能有哪些**   —— 沿「入口 / HTTP 路由 → 类 → 类」的调用方向做**可达性聚类**
 *   ② **每个功能多大** —— 闭包里的类数、出边数、横跨几个服务单元
 *   ③ **剥掉它会动多少** —— 闭包里的文件清单 + 从外部打进闭包的边（切断点）
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要「闭包聚类」而不是「按 Controller 分组」：
 *
 *   按 Controller 分组会把一条业务链切成三块（Controller / Service / Mapper 各一块），
 *   而「剥掉这个功能要动多少」问的恰恰是**那三块是一件事**。
 *   所以聚类的单位是**可达性**，不是目录、不是命名。
 *
 * ─────────────────────────────────────────────────────────────
 * 四条判据纪律（每条都对应一个本仓已经付过学费的事故）：
 *
 * ① **只沿收集到的边聚类，不推断。** 反射、SPI、字符串拼类名这些静态扫不到的调用，
 *    这里<b>假装不存在</b>。所以「闭包外的类」不一定与功能无关 ——
 *    每张表必须带一条 caveat 说清这件事，否则「剥掉它只动 6 个类」会被当成保证。
 *
 * ② **0 个入口 / 0 条边时也要出结论。** 一个空图不是「功能分得很干净」，
 *    是「没扫到调用关系」。这两者在 UI 上都显示成空白时最难查（10-03 教训）。
 *
 * ③ **「不可达」要单列，不要塞进某个功能。** 被入口触不到的类可能是死代码、
 *    也可能是定时任务 / MQ 消费者这类<b>另一个入口</b>。把它们塞进最近的功能里，
 *    就会得到一个虚高的「闭包大小」，而那个数字正是决策依据。
 *
 * ④ **聚类结果与文件清单都必须可复现。** 同��份 facts 跑两次逐字段相等 ——
 *    邻接表的遍历顺序会变，所以出口与入口一律显式排序。
 */

/** 与 `facts-arch` 的字段同名 —— 这里不再抄一份形状定义。 */
export interface CallFacts {
  directCalls?: { from: string; to: string; file: string }[];
  routes?: { method: string; path: string; handler: string; file: string; line: number }[];
  entryPoints?: { file: string; line: number; package: string | null; className: string | null; runtime: string }[];
  clients?: { kind: string; target: string | null; file: string; line: number }[];
  packages?: { path: string; files: number }[];
}

/** 聚类单元：一条从入口出发的可达闭包。 */
export interface FeatureCluster {
  /** 稳定 id：由种子类名派生，改名就换 id（这是有意的 —— 静默跟住改名会让人认不出它） */
  id: string;
  /** 人类可读的名字：种子类名 + 它带的路由 */
  label: string;
  /** 种子（这条链的起点）：入口类或路由处理类 */
  seed: string;
  seedKind: 'entrypoint' | 'route' | 'unreachable-group';
  /** 闭包里的类（不含 seed 时也含自己），已排序 */
  classes: string[];
  /** 闭包里的文件，已排序。**这是「剥掉它要动哪些文件」的直接答案** */
  files: string[];
  /** 从闭包外打进闭包的边 —— 切断点。外部调用者必须先看这个 */
  inbound: { from: string; to: string; file: string }[];
  /** 闭包出边数（去外部的） */
  outbound: number;
  /** 闭包内边数 */
  internal: number;
  /** 这条链带的 HTTP 路由 */
  routes: { method: string; path: string; handler: string; file: string; line: number }[];
  /** 横跨几个服务单元（由调用方按 service-topo 的结果填；这里只留位） */
  serviceSpread?: number;
}

export interface FunctionView {
  clusters: FeatureCluster[];
  /** 没被任何入口触到的类 —— 可能是死代码，也可能是另一个入口（定时任务 / MQ）。单列，不塞进任何功能 */
  unreachable: { classes: string[]; files: string[] };
  /** 聚类口径的总账，页面上要原样显示 */
  stats: {
    classes: number;
    edges: number;
    seeds: number;
    clusters: number;
    /** 被多簇共享的类 —— 它是耦合点，「剥掉一个功能」时最容易连带崩掉的就是这些 */
    sharedClasses: { class: string; clusters: number }[];
  };
  /** 三条不许破的规矩对应的原话 */
  caveats: string[];
}

/** 阈值：闭包超过这个数就停止扩展，并把结果标成「可能不完整」。 */
export const MAX_CLUSTER_CLASSES = 400;

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

/**
 * 从 facts 算功能视图。**纯函数** —— 不读盘、不发请求、不碰 React。
 *
 * @param facts 解剖台静态事实；缺失字段一律按空处理
 */
export function buildFunctionView(facts: CallFacts | null | undefined): FunctionView {
  const calls = facts?.directCalls ?? [];
  const routes = facts?.routes ?? [];
  const entries = facts?.entryPoints ?? [];

  // ── 邻接表（同向去重，排序固定 → 确定性） ────────────────────
  const out = new Map<string, Set<string>>();
  const inboundEdges = new Map<string, { from: string; to: string; file: string }[]>();
  const edgeFiles = new Map<string, string>(); // "from→to" → 证据文件
  for (const c of calls) {
    if (!c?.from || !c?.to) continue;
    if (c.from === c.to) continue; // 自递归不是跨类调用
    let s = out.get(c.from);
    if (!s) out.set(c.from, (s = new Set()));
    s.add(c.to);
    const key = `${c.from}→${c.to}`;
    if (!edgeFiles.has(key)) edgeFiles.set(key, c.file ?? '');
    const into = inboundEdges.get(c.to);
    if (!into) inboundEdges.set(c.to, [{ from: c.from, to: c.to, file: c.file ?? '' }]);
    else if (!into.some((e) => e.from === c.from)) {
      into.push({ from: c.from, to: c.to, file: c.file ?? '' });
    }
  }

  const allClasses = new Set<string>();
  for (const [f, t] of out) {
    allClasses.add(f);
    for (const x of t) allClasses.add(x);
  }
  for (const c of calls) {
    if (c?.file) allClasses.add(c.file); // 文件名也在图里，便于 files 聚合
  }
  for (const e of entries) {
    if (e?.className) allClasses.add(e.className);
  }
  for (const r of routes) {
    if (r?.handler) allClasses.add(r.handler);
  }

  // ── 种子：入口类 + 路由处理类。没有它们就没有「功能」，只有一堆类 ──
  const seeds: { cls: string; kind: 'entrypoint' | 'route' }[] = [];
  for (const e of entries) {
    if (e?.className) seeds.push({ cls: e.className, kind: 'entrypoint' });
  }
  for (const r of routes) {
    // handler 是 "UserController#getUser" 形态（CodeScanner 出品）——
    // 种子必须取类名那半，否则与调用边上的类名永远对不上，路由链全部悬空。
    const cls = handlerClass(r?.handler);
    if (cls) seeds.push({ cls, kind: 'route' });
  }
  // 去重 + 排序：同一类既是入口又是路由处理时只留一条，且 kind 取更靠前的那个
  const seedMap = new Map<string, 'entrypoint' | 'route'>();
  for (const s of seeds) {
    if (!seedMap.has(s.cls)) seedMap.set(s.cls, s.kind);
  }
  const orderedSeeds = [...seedMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const clusters: FeatureCluster[] = [];
  const assigned = new Set<string>();

  for (const [seed, kind] of orderedSeeds) {
    const reach = reachable(seed, out);
    const truncated = reach.size >= MAX_CLUSTER_CLASSES;
    const classes = [...reach].sort();
    const id = clusterId(seed);
    const myRoutes = routes
      .filter((r) => handlerClass(r.handler) === seed)
      .map((r) => ({ method: r.method, path: r.path, handler: r.handler, file: r.file, line: r.line }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const inb = (inboundEdges.get(seed) ?? [])
      .filter((e) => !reach.has(e.from))
      .map((e) => ({ from: e.from, to: e.to, file: e.file }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    const files = filesOf(classes, calls, reach);
    let internal = 0;
    let outbound = 0;
    for (const [f, ts] of out) {
      if (!reach.has(f)) continue;
      for (const t of ts) {
        if (reach.has(t)) internal++;
        else outbound++;
      }
    }
    const c: FeatureCluster = {
      id,
      label: labelOf(seed, kind, myRoutes),
      seed,
      seedKind: kind,
      classes,
      files,
      inbound: inb,
      outbound,
      internal,
      routes: myRoutes,
    };
    if (truncated) {
      c.label += `（闭包达到 ${MAX_CLUSTER_CLASSES} 个类上限，结果可能不完整）`;
    }
    clusters.push(c);
    for (const cls of classes) assigned.add(cls);
  }

  // ── ③ 不可达：单列，不塞进任何功能 ──────────────────────────
  const unreachableClasses = [...allClasses].filter((c) => !assigned.has(c) && !c.includes('/')).sort();
  const unreachableFiles = [...new Set(calls.map((c) => c.file).filter((f) => f && f.includes('/')))].sort();

  // ── 共享类：耦合点 ──────────────────────────────────────────
  // 一遍遍历建「类 → 触到它的簇」倒排，而不是对每个类去 clusters 里 includes（那是 O(n²)，
  // 而且簇一多就成建页面时那段空白卡顿的原因）。
  const owners = new Map<string, Set<string>>();
  for (const c of clusters) {
    for (const cls of c.classes) {
      let s = owners.get(cls);
      if (!s) owners.set(cls, (s = new Set()));
      s.add(c.id);
    }
  }
  const sharedClasses = [...owners.entries()]
    .filter(([, ids]) => ids.size >= 2)
    .map(([cls, ids]) => ({ class: cls, clusters: ids.size }))
    .sort((a, b) => b.clusters - a.clusters || (a.class < b.class ? -1 : 1));

  return {
    clusters,
    unreachable: { classes: unreachableClasses, files: unreachableFiles },
    stats: {
      classes: allClasses.size,
      edges: calls.length,
      seeds: orderedSeeds.length,
      clusters: clusters.length,
      sharedClasses,
    },
    caveats: [
      '聚类只沿静态扫到的调用边走。反射 / SPI / 字符串拼类名这类调用扫不到，' +
        '所以「闭包外的类」不一定与这个功能无关 —— 别把闭包大小当成剥离成本的保证。',
      '一个类同时被多个功能触到时，它进第一条链的闭包，并出现在其余链的 inbound 里 —— ' +
        '剥掉任一功能前都要先看 inbound 与共享类清单。',
      unreachableClasses.length > 0
        ? `有 ${unreachableClasses.length} 个类没被任何入口触到。它们可能是死代码，` +
          '也可能是定时任务 / MQ 消费者这类另一个入口 —— 所以单列，不并进任何功能。'
        : '每个类都被至少一个入口触到了 —— 这在真实项目里少见，别当成「分析很准」的好消息。',
    ],
  };
}

// ═══════════════════════════════════════════════════════════════
// 内部
// ═══════════════════════════════════════════════════════════════

/** 从 seed 出发沿出边做 BFS，有上限。 */
function reachable(seed: string, out: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>([seed]);
  const queue: string[] = [seed];
  while (queue.length > 0 && seen.size < MAX_CLUSTER_CLASSES) {
    const cur = queue.shift()!;
    for (const t of out.get(cur) ?? []) {
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
        if (seen.size >= MAX_CLUSTER_CLASSES) break;
      }
    }
  }
  return seen;
}

/** 闭包涉及的文件：边上的证据文件 + 类名里能直接对上的源文件。 */
function filesOf(classes: string[], calls: { from: string; to: string; file: string }[], reach: Set<string>): string[] {
  const set = new Set<string>();
  for (const c of calls) {
    if ((reach.has(c.from) || reach.has(c.to)) && c.file) set.add(c.file);
  }
  for (const cls of classes) {
    // 类名全限定 → 源文件路径的常见形态。这是**约定**不是推断，所以只在能对上时加。
    const guess = cls.replace(/\./g, '/') + '.java';
    if (cls.includes('.')) set.add(guess);
  }
  return [...set].sort();
}

function clusterId(seed: string): string {
  return `fn:${seed}`;
}

/** 路由 handler（"UserController#getUser"）→ 类名（"UserController"）。没有 "#" 时原样返回。 */
function handlerClass(handler: string | undefined): string {
  if (!handler) return '';
  const i = handler.indexOf('#');
  return i >= 0 ? handler.slice(0, i) : handler;
}

function labelOf(seed: string, kind: 'entrypoint' | 'route', routes: { method: string; path: string }[]): string {
  if (routes.length > 0) {
    const r = routes[0];
    return `${seed}（${r.method} ${r.path}${routes.length > 1 ? ` 等 ${routes.length} 条路由` : ''}）`;
  }
  return kind === 'entrypoint' ? `${seed}（可运行入口）` : seed;
}

/**
 * 「这次 diff 影响了哪些功能」—— C3 PR 机器人的行级映射入口。
 *
 * <p>与聚类共用一份算法：改一个文件 → 找出引用了它的边 → 边所在闭包 = 受影响的功能。
 * 单独写一份会漂（本仓 10-04 双实现事故）。
 *
 * @param changedFiles 本次改动涉及的仓库相对路径
 */
export function affectedFeatures(view: FunctionView, changedFiles: string[]): FeatureCluster[] {
  const changed = new Set(changedFiles);
  if (changed.size === 0) return [];
  return view.clusters.filter((c) => c.files.some((f) => changed.has(f)));
}

/**
 * 行级映射：某个文件的哪些行落在「本次改动」里。
 *
 * <p>来自 unified diff 的 hunk 头（{@code @@ -a,b +c,d @@}），解析失败返回空集合 ——
 * **解析不出来时返回空而不是返回全部**：全部会让「这次改动影响了整个文件」变成默认值，
 * 而那正是行级映射最不该有的默认。
 */
export function changedLinesFromDiff(diffText: string, file: string): Set<number> {
  const lines = new Set<number>();
  if (!diffText) return lines;
  let inFile = false;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git')) {
      inFile = line.includes(` b/${file}`);
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (!inFile) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }
  return lines;
}

/** 一条 finding 的行是否落在本次改动的行里。**没落进 = 这次改动没碰它**，不是「它不存在」。 */
export function findingTouchedByDiff(finding: { file: string; line: number }, diffText: string): boolean {
  const changed = changedLinesFromDiff(diffText, finding.file);
  if (changed.size === 0) return false;
  return changed.has(finding.line);
}
