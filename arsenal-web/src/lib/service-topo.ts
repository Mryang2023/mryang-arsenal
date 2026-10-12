/**
 * facts.services → 服务拓扑（纯函数，零依赖，不碰 React）。
 *
 * 回答的问题是「**这个项目有几个服务**」—— 但不是猜一个数字，而是把每条
 * 服务声明连同出处列出来：能精确合并的合并，合并不了的并排说清。
 *
 * 五条不能破的规矩（与 00-计划书.md 第 1 节一一对应）：
 *
 *   ① **只精确匹配，不做名称归一化。**`order-service` 与 `order-svc`、`order`
 *      并排展示。归一化是猜；猜错会把两个服务并成一个 —— 比不合并危险得多。
 *   ② **模块 ≠ 服务。**Maven modules / k8s Service / Dockerfile / Helm chart
 *      分别报告，不计入服务数（见 infra / nonWorkload / unattributed 三个桶）。
 *   ③ **归属不了的进「未归属」桶**，显式计数，不静默丢弃、不强行归给最近的一个。
 *   ④ **0 和 1 也是结论**：没有信号时说清「检查过哪些信号」；只有一个入口时说「单体特征」。
 *   ⑤ **各源数量分开报**：compose 说 4 个、k8s 说 3 个、代码入口 3 个 ——
 *      三个数并列 + 冲突清单。「4 vs 3」合并成一个数，就和猜没有区别（10-04 教训）。
 *
 * 这个文件是**全仓唯一一份服务关联实现**（Java 侧只摊平事实不关联，见
 * ProjectScanner.serviceDeclarations 的注释）—— 判定逻辑写两份就会漂移，
 * 10-04 踩过。要改判据，只改这里，并且必须过 scan-check 的正反样本。
 *
 * 归属规则（三条，全部精确匹配，matchedOn 记录用的是哪条）：
 *   R1 dir-name —— 文件路径的第一段（`order-service/src/…` → `order-service`）
 *       与某个服务单元名恰好相等。mono-repo 的惯例布局就走这条。
 *   R2 name     —— 代码入口的类名与单元名恰好相等（少见，但便宜）。
 *   R3 package  —— 入口类的包路径是文件路径的子串（`com/acme/order/`），
 *       经该入口间接归属。共享库布局走这条；比 R1 粗，所以排在最后。
 */

// ─────────────────────────────────────────────────────────────
// 一、封闭集合（K8s API 与知名基础设施产品的事实清单，不是本项目的「知识」）
// ─────────────────────────────────────────────────────────────

/** k8s 工作负载 kind —— 只有这些算「跑起来的东西」。Service / Ingress 是网络声明，ConfigMap / Secret 是配置 */
export const WORKLOAD_KINDS: ReadonlySet<string> = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Job',
  'CronJob',
]);

/**
 * 知名基础设施镜像名（取镜像名最后一段、去掉 tag：`bitnami/redis:7` → `redis`）。
 *
 * 保守方向：**认不出的一律不算基础设施**（宁可多报一个单元，也不静默吞掉一个），
 * 且被排除的条目全部进 infra 桶带证据列出来 —— 识别错了一眼能看见。
 */
const INFRA_IMAGES: ReadonlySet<string> = new Set([
  'mysql', 'mariadb', 'postgres', 'postgresql', 'timescaledb',
  'redis', 'memcached', 'keydb',
  'mongo', 'mongodb',
  'rabbitmq', 'kafka', 'zookeeper', 'activemq', 'nats', 'pulsar',
  'elasticsearch', 'opensearch', 'kibana', 'logstash',
  'nginx', 'httpd', 'apache', 'traefik', 'envoy', 'haproxy',
  'consul', 'etcd', 'vault', 'minio', 'registry',
]);

function infraNameOf(image: string | null): string | null {
  if (!image) return null;
  const base = image.replace(/^.*\//, '').split(':')[0].toLowerCase();
  return INFRA_IMAGES.has(base) ? base : null;
}

// ─────────────────────────────────────────────────────────────
// 二、类型
// ─────────────────────────────────────────────────────────────

export interface ServiceSource {
  source: 'compose' | 'k8s' | 'code-entry';
  name: string | null;
  path: string;
  line: number;
  kind: string | null;
  runtime?: string;
  port: number | null;
  replicas: number | null;
  image: string | null;
  build: string | null;
  pkg: string | null;
  dependsOn: string[];
}

export interface ServiceEntry {
  className: string | null;
  file: string;
  line: number;
  runtime: string;
  /** 入口类的包名（`com.acme.order`）—— facts 里字段名是 package（Java 侧 record 组件叫 pkg 避开保留字，序列化时手写 put("package", …)） */
  package: string | null;
}

export interface ServiceUnit {
  name: string;
  sources: ServiceSource[];
  entries: ServiceEntry[];
  routes: { method: string; path: string; handler: string; file: string; line: number }[];
  dockerfiles: string[];
  poms: string[];
  /** 只有代码、没有部署声明 */
  codeOnly: boolean;
  /** 入口挂到本单元的依据（R1 dir-name / R2 name / null = 自建单元） */
  matchedOn: 'dir-name' | 'name' | null;
}

export interface ServiceConflict {
  kind: 'declared-no-code' | 'port-mismatch' | 'replica-mismatch';
  unit: string;
  detail: string;
  evidence: string[];
}

export interface ServiceTopo {
  units: ServiceUnit[];
  /** 基础设施容器（compose 镜像命中知名清单）—— 列出但不计数 */
  infra: { name: string; image: string; evidence: string }[];
  /** k8s 非工作负载条目（Service / ConfigMap …）—— 网络与配置声明，不是服务 */
  nonWorkload: { name: string | null; kind: string; evidence: string }[];
  /** 读不到名称的声明（k8s name 缺失）—— 无法分组，原样列出 */
  unnamed: ServiceSource[];
  /** 服务间调用边（feign / depends_on）。每条的 from/to 都是单元名，to 也可以是基础设施名 */
  edges: { from: string; to: string; kind: string; evidence: string }[];
  /**
   * 指向声明之外的目标（feign / depends_on 名字匹配不上任何单元）。
   * `from` 是调用方（单元名或 `(未归属)`）—— 没有它，渲染器只能画一个
   * 孤立的外部节点，看页面的人无从知道它是从哪来的（2026-10-12 实测教训）。
   */
  externals: { from: string; target: string; kind: string; evidence: string }[];
  /** nginx 转发到本单元（host token 精确匹配单元名） */
  ingress: { unit: string; upstream: string; evidence: string }[];
  /** nginx 上游 token 里匹配不上任何单元的（upstream 块名常见，列出不静默） */
  ingressUnmatched: string[];
  /** 读不到目标的客户端数（RestTemplate / WebClient 的地址常在配置里） */
  unresolvedTargets: number;
  unattributed: {
    routes: { method: string; path: string; file: string }[];
    dockerfiles: string[];
    poms: string[];
  };
  conflicts: ServiceConflict[];
  counts: {
    compose: number;
    k8sWorkload: number;
    codeEntry: number;
    units: number;
    infra: number;
    nonWorkload: number;
    unnamed: number;
    edges: number;
    externals: number;
    unresolvedTargets: number;
    unattributedRoutes: number;
  };
  notes: string[];
}

// ─────────────────────────────────────────────────────────────
// 三、小工具
// ─────────────────────────────────────────────────────────────

function firstSegment(file: string): string | null {
  const i = file.indexOf('/');
  return i > 0 ? file.slice(0, i) : null;
}

/** java 文件路径 → 包路径（`…/src/main/java/com/acme/order/X.java` → `com/acme/order/X`）。
 *  前缀 `(?:^|\/)` 两种布局都要认：src/ 在仓库根（单体）和在服务子目录（mono-repo） */
function packagePathOf(file: string): string | null {
  const m = /(?:^|\/)src\/(?:main|test)\/java\/(.+?)\.java$/.exec(file);
  return m ? m[1] : null;
}

function ev(path: string, line: number): string {
  return line > 0 ? `${path}:${line}` : path;
}

function sortBy<T>(arr: T[], key: (t: T) => string): T[] {
  return [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

const SOURCE_ORDER: Record<string, number> = { compose: 0, k8s: 1, 'code-entry': 2 };

// ─────────────────────────────────────────────────────────────
// 四、主函数
// ─────────────────────────────────────────────────────────────

export function buildServiceTopo(facts: {
  services?: { declarations?: ServiceSource[] };
  code?: {
    routes?: { method: string; path: string; handler: string; file: string; line: number }[];
    clients?: { kind: string; target: string | null; file: string; line: number }[];
    entryPoints?: ServiceEntry[];
  };
  deploy?: { dockerfiles?: { path: string; exposedPorts: number[] }[]; nginx?: { path: string; upstreams: string[] }[] };
  build?: { artifacts?: { path: string; artifactId: string | null }[] };
}): ServiceTopo {
  const declarations = facts.services?.declarations ?? [];
  const routes = facts.code?.routes ?? [];
  const clients = facts.code?.clients ?? [];
  const entries = facts.code?.entryPoints ?? [];
  const dockerfiles = facts.deploy?.dockerfiles ?? [];
  const nginxFiles = facts.deploy?.nginx ?? [];
  const artifacts = facts.build?.artifacts ?? [];

  // ── 1. 分桶：基础设施 / 非工作负载 / 可分组声明 ──────────────
  const infra: ServiceTopo['infra'] = [];
  const nonWorkload: ServiceTopo['nonWorkload'] = [];
  const unnamed: ServiceSource[] = [];
  const units = new Map<string, ServiceUnit>();

  const unitOf = (name: string): ServiceUnit => {
    let u = units.get(name);
    if (!u) {
      u = { name, sources: [], entries: [], routes: [], dockerfiles: [], poms: [], codeOnly: false, matchedOn: null };
      units.set(name, u);
    }
    return u;
  };

  const composeServiceCount = declarations.filter((d) => d.source === 'compose').length;
  const k8sWorkloadCount = declarations.filter((d) => d.source === 'k8s' && WORKLOAD_KINDS.has(d.kind ?? '')).length;

  for (const d of declarations) {
    if (d.source === 'compose') {
      const infraImg = infraNameOf(d.image);
      if (infraImg && d.name) {
        // 基础设施容器：mysql:8.0 / redis:7 这类。列出、带证据、不计数
        infra.push({ name: d.name, image: d.image as string, evidence: ev(d.path, d.line) });
        continue;
      }
      if (d.name == null) {
        unnamed.push(d);
        continue;
      }
      unitOf(d.name).sources.push(d);
    } else if (d.source === 'k8s') {
      if (!WORKLOAD_KINDS.has(d.kind ?? '')) {
        nonWorkload.push({ name: d.name, kind: d.kind ?? '(未读到)', evidence: ev(d.path, d.line) });
        continue;
      }
      if (d.name == null) {
        unnamed.push(d);
        continue;
      }
      unitOf(d.name).sources.push(d);
    }
  }

  // ── 2. 代码入口挂载（R1 dir-name → R2 name → 自建单元）──────
  const pkgUnits = new Map<string, string>(); // 包路径 → 单元名（R3 用）
  const codeEntryCount = entries.length;
  const entryRuntimeCount: Record<string, number> = {};
  for (const e of entries) {
    entryRuntimeCount[e.runtime] = (entryRuntimeCount[e.runtime] ?? 0) + 1;
    let unit: ServiceUnit | null = null;
    let matchedOn: 'dir-name' | 'name' | null = null;
    const seg = firstSegment(e.file);
    if (seg && units.has(seg)) {
      unit = units.get(seg)!;
      matchedOn = 'dir-name';
    } else if (e.className && units.has(e.className)) {
      unit = units.get(e.className)!;
      matchedOn = 'name';
    }
    if (unit) {
      if (!unit.matchedOn) unit.matchedOn = matchedOn;
    } else {
      // 代码里有入口、部署清单没有对应声明 —— 自成一个单元，codeOnly 标出来
      unit = unitOf(e.className ?? '(未命名入口)');
      unit.codeOnly = true;
    }
    unit.entries.push(e);
    if (e.package) pkgUnits.set(e.package.replace(/\./g, '/'), unit.name);
  }

  // ── 3. 归属函数（路由 / 客户端 / Dockerfile / pom 共用）──────
  const ownerOf = (file: string): { unit: ServiceUnit; on: 'dir-name' | 'package' } | { unit: null; on: null } => {
    const seg = firstSegment(file);
    if (seg && units.has(seg)) return { unit: units.get(seg)!, on: 'dir-name' };
    const pkgPath = packagePathOf(file);
    if (pkgPath) {
      // 包前缀匹配：入口包 com/acme/order 是文件路径的前缀（尾斜杠防 order/ 咬住 orderextra/）
      for (const [pkg, unitName] of pkgUnits) {
        if (pkgPath.startsWith(pkg + '/')) return { unit: units.get(unitName)!, on: 'package' };
      }
    }
    return { unit: null, on: null };
  };

  const unattributedRoutes: ServiceTopo['unattributed']['routes'] = [];
  const unattributedDockerfiles: string[] = [];
  const unattributedPoms: string[] = [];

  for (const r of routes) {
    const o = ownerOf(r.file);
    if (o.unit) o.unit.routes.push(r);
    else unattributedRoutes.push({ method: r.method, path: r.path, file: r.file });
  }

  for (const df of dockerfiles) {
    const seg = firstSegment(df.path);
    if (seg && units.has(seg)) units.get(seg)!.dockerfiles.push(df.path);
    else unattributedDockerfiles.push(df.path);
  }
  for (const a of artifacts) {
    const seg = firstSegment(a.path);
    if (seg && units.has(seg)) units.get(seg)!.poms.push(a.path);
    else unattributedPoms.push(a.path);
  }

  // ── 4. 调用边 ───────────────────────────────────────────────
  const edges: ServiceTopo['edges'] = [];
  const externals: ServiceTopo['externals'] = [];
  let unresolvedTargets = 0;

  for (const c of clients) {
    const o = ownerOf(c.file);
    const from = o.unit ? o.unit.name : '(未归属)';
    if (c.target == null) {
      // RestTemplate / WebClient：地址常在配置里，静态读不到 —— 计数，不猜
      unresolvedTargets += 1;
      continue;
    }
    if (units.has(c.target)) {
      edges.push({ from, to: c.target, kind: c.kind, evidence: ev(c.file, c.line) });
    } else {
      externals.push({ from, target: c.target, kind: c.kind, evidence: ev(c.file, c.line) });
    }
  }

  for (const d of declarations) {
    if (d.source !== 'compose' || d.name == null) continue;
    for (const dep of d.dependsOn ?? []) {
      if (units.has(dep) || infra.some((i) => i.name === dep)) {
        edges.push({ from: d.name, to: dep, kind: 'depends_on', evidence: ev(d.path, d.line) });
      } else {
        externals.push({ from: d.name, target: dep, kind: 'depends_on', evidence: ev(d.path, d.line) });
      }
    }
  }

  const ingress: ServiceTopo['ingress'] = [];
  const ingressUnmatched: string[] = [];
  for (const nf of nginxFiles) {
    for (const token of nf.upstreams ?? []) {
      const host = token.split(':')[0];
      if (units.has(host)) ingress.push({ unit: host, upstream: token, evidence: nf.path });
      else ingressUnmatched.push(token);
    }
  }

  // ── 5. 冲突（结构化，面板逐条展开）────────────────────────
  const conflicts: ServiceConflict[] = [];
  for (const u of [...units.values()]) {
    const deploySources = u.sources.filter((s) => s.source !== 'code-entry');
    if (deploySources.length > 0 && u.entries.length === 0 && u.routes.length === 0
        && u.poms.length === 0 && u.dockerfiles.length === 0) {
      conflicts.push({
        kind: 'declared-no-code',
        unit: u.name,
        // 措辞说准：是「没有代码能归属到它」，不是「仓库里找不到代码」——
        // 单体仓库的代码就在根目录，只是名字对不上（demo-repo 实测教训）
        detail: `部署清单声明了「${u.name}」，但没有任何可运行入口、路由或构建文件能归属到它（目录名与包路径精确匹配都对不上）`,
        evidence: u.sources.map((s) => ev(s.path, s.line)),
      });
    }
    const ports = new Map<string, string>();
    for (const s of u.sources) {
      if (s.port != null) ports.set(String(s.port), `${s.source} 声明（${ev(s.path, s.line)}）`);
    }
    if (ports.size > 1) {
      conflicts.push({
        kind: 'port-mismatch',
        unit: u.name,
        detail: `端口两处不一致：${[...ports].map(([p, w]) => `${p} 来自${w}`).join('；')} —— 都列出来，不挑一个当好话`,
        evidence: u.sources.filter((s) => s.port != null).map((s) => ev(s.path, s.line)),
      });
    }
    const reps = new Map<string, string>();
    for (const s of u.sources) {
      if (s.replicas != null) reps.set(String(s.replicas), `${s.source} 声明（${ev(s.path, s.line)}）`);
    }
    if (reps.size > 1) {
      conflicts.push({
        kind: 'replica-mismatch',
        unit: u.name,
        detail: `副本数两处不一致：${[...reps].map(([p, w]) => `${p} 来自${w}`).join('；')}`,
        evidence: u.sources.filter((s) => s.replicas != null).map((s) => ev(s.path, s.line)),
      });
    }
  }

  // ── 6. 计数与人读结论（固定顺序，0 的情况也要说）────────────
  const unitList = sortBy([...units.values()], (u) => u.name).map((u) => ({
    ...u,
    sources: [...u.sources].sort(
      (a, b) => (SOURCE_ORDER[a.source] ?? 9) - (SOURCE_ORDER[b.source] ?? 9) || ev(a.path, a.line).localeCompare(ev(b.path, b.line))
    ),
    entries: sortBy(u.entries, (e) => e.file),
    routes: sortBy(u.routes, (r) => r.file + r.line),
  }));

  const counts: ServiceTopo['counts'] = {
    compose: composeServiceCount,
    k8sWorkload: k8sWorkloadCount,
    codeEntry: codeEntryCount,
    units: unitList.length,
    infra: infra.length,
    nonWorkload: nonWorkload.length,
    unnamed: unnamed.length,
    edges: edges.length,
    externals: externals.length,
    unresolvedTargets,
    unattributedRoutes: unattributedRoutes.length,
  };

  const notes: string[] = [];
  const runtimeSummary = Object.entries(entryRuntimeCount)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
  if (codeEntryCount === 0) {
    notes.push('代码里没有找到可运行入口（@SpringBootApplication / main / package.json scripts.start 都没有）—— 「0 个入口」本身是一条结论，也可能是这些信号没覆盖到');
  } else {
    notes.push(`代码侧可运行入口 ${codeEntryCount} 个（${runtimeSummary}）—— 这个仓库跑起来是 ${codeEntryCount} 个进程`);
    if (codeEntryCount === 1) {
      notes.push('只有一个可运行入口 —— 单体特征；部署侧的其余声明见下方分桶（基础设施 / 网络声明分别列，不混进服务数）');
    }
  }
  if (composeServiceCount > 0) {
    notes.push(
      infra.length > 0
        ? `compose 声明 ${composeServiceCount} 个服务，其中 ${infra.length} 个是基础设施容器（${sortBy(infra, (i) => i.name).map((i) => i.name).join('、')}）—— 后者列出但不计数`
        : `compose 声明 ${composeServiceCount} 个服务，没有识别出基础设施容器`
    );
  }
  if (k8sWorkloadCount > 0 || nonWorkload.length > 0) {
    notes.push(
      `k8s 工作负载 ${k8sWorkloadCount} 个；另有 ${nonWorkload.length} 个非工作负载条目（Service / ConfigMap 等网络与配置声明），不计入服务数`
    );
  }
  const composeServices = composeServiceCount - infra.length;
  if (composeServices > 0 && k8sWorkloadCount > 0 && composeServices !== k8sWorkloadCount) {
    notes.push(`部署两侧数量不一致：compose ${composeServices} 个 vs k8s 工作负载 ${k8sWorkloadCount} 个 —— 分开报，不取平均、不猜哪个对`);
  }
  const codeOnly = unitList.filter((u) => u.codeOnly);
  if (codeOnly.length > 0) {
    notes.push(`代码里有入口但部署清单没有对应声明：${codeOnly.map((u) => u.name).join('、')} —— 自成一个单元（codeOnly）`);
  }
  for (const c of conflicts) {
    if (c.kind === 'declared-no-code') notes.push(`部署清单声明了「${c.unit}」，但没有任何可运行入口、路由或构建文件能归属到它（${c.evidence.join('、')}）`);
  }
  if (unattributedRoutes.length > 0) {
    notes.push(`${unattributedRoutes.length} 条路由无法归属到任何服务单元（目录名与包路径都对不上）—— 进未归属桶，不强行归给最近的一个`);
  }
  if (unresolvedTargets > 0) {
    notes.push(`${unresolvedTargets} 个 HTTP 客户端读不到目标（RestTemplate / WebClient 的地址常在配置里）—— 计数，不猜`);
  }
  if (externals.length > 0) {
    notes.push(`调用图里有 ${externals.length} 个外部目标（feign / depends_on 指向声明之外的名字）：${sortBy(externals, (e) => e.target).map((e) => `${e.from}→${e.target}`).join('、')}`);
  }
  if (declarations.length === 0 && codeEntryCount === 0) {
    notes.push('未发现任何服务边界信号 —— 检查过：compose 服务 / k8s 工作负载 / 代码可运行入口。没有信号不等于没有服务，只等于这些信号没读到');
  }

  return {
    units: unitList,
    infra: sortBy(infra, (i) => i.name),
    nonWorkload: sortBy(nonWorkload, (n) => n.evidence),
    unnamed,
    edges: sortBy(edges, (e) => `${e.from}|${e.to}|${e.kind}`),
    externals: sortBy(externals, (e) => `${e.from}|${e.target}|${e.kind}`),
    ingress: sortBy(ingress, (i) => `${i.unit}|${i.upstream}`),
    ingressUnmatched: sortBy(ingressUnmatched, (s) => s),
    unresolvedTargets,
    unattributed: {
      routes: sortBy(unattributedRoutes, (r) => r.file + r.path),
      dockerfiles: sortBy(unattributedDockerfiles, (s) => s),
      poms: sortBy(unattributedPoms, (s) => s),
    },
    conflicts: sortBy(conflicts, (c) => `${c.kind}|${c.unit}`),
    counts,
    notes,
  };
}
