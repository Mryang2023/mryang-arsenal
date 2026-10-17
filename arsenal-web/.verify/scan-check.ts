/**
 * 代码扫描引擎的守门人 —— 「别人给的仓库，扫出来的事实对不对」这件事第一次有了断言。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么这一层不能只在 TS 里造一份 facts 来验：
 *
 * 在 TS 里手搓一份「期望的 ProjectFacts」，然后断言 buildArchifyIrFromFacts 能跑通，
 * 那是**恒真**的 —— 验的是我们自己造的输入，不是扫描器真的读出来的东西。
 * 所以这里走后端探针（.verify/ScanProbe.java）实跑：给它 fixture 目录，
 * 让它把真实事实吐出来，再逐字段对。
 *
 * ─────────────────────────────────────────────────────────────
 * 四类断言，缺一不可：
 *
 *   ① fixture 逐字段（事实对不对）
 *   ② 恶意输入（闸门有没有真的拦住）
 *   ③ 确定性（同一份输入扫两次必须逐字段相等，否则图会随机变）
 *   ④ 脱敏（密码不许出现在事实里）
 *
 * 跑法：npm run verify:scan（需要 bash + JDK 17，缺一指明说跳过）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  buildArchifyIrFromFacts,
  buildLayeredArch,
  buildLayeredSvg,
  buildTechArchFromFacts,
  factsToPicks,
  summarizeFacts,
} from '../src/lib/facts-arch';
import {
  autopsyCoverage,
  autopsyUnmatched,
  buildAutopsy,
  serviceGraphOpts,
  traceSource,
} from '../src/lib/autopsy-data';
import { scanStats } from '../src/lib/scan-rules';
import { CANVAS_THEME_OPTIONS, buildTechArchSvg } from '../src/lib/arch-canvas';
import { archifyIrIssues, archifyIrShapeIssues } from '../src/lib/archify-ir';
import { buildProfileDraftFromFacts } from '../src/lib/profile-draft';
import {
  buildCodeStructure,
  classBadge,
  structureMarkdown,
  type CodeStructure,
} from '../src/lib/code-structure';
import { BAND_DESC, BAND_NAME, BAND_ORDER } from '../src/lib/arch-layered';
import { buildServiceTopo } from '../src/lib/service-topo';
import { buildServiceGraphSvg } from '../src/lib/service-graph';
import {
  declaredPort,
  healthWording,
  reconcileRuntime,
  type RuntimeProbeFact,
} from '../src/lib/runtime-recon';
import type { AutopsyReport } from '../src/lib/arsenal-api';
import {
  buildSnapshot,
  diffSnapshots,
  findingKey,
  fingerprintTrust,
  projectIdOfSource,
  redactSourceValue,
  reusableSnapshot,
} from '../src/lib/autopsy-snapshot';
import {
  resolveAutopsyDir,
  saveSnapshot as saveSnapshotDisk,
  listSnapshots as listSnapshotsDisk,
  loadLatest as loadLatestDisk,
} from '../scripts/lib/autopsy-store.mjs';
import {
  collectDirTree,
  fingerprintDirTree,
  fingerprintGitState,
  projectIdOf,
  readGitState,
} from '../scripts/lib/autopsy-fingerprint.mjs';
import {
  appendPoint,
  listPoints,
  newPointId,
  seriesFile,
} from '../scripts/lib/vitals-store.mjs';
import {
  SERIES_SCHEMA_VERSION,
  diffPoints,
  formatDiff,
} from '../scripts/lib/vitals-point.mjs';
import { buildVitalsSeries, EMPTY_SERIES_MESSAGE } from '../src/lib/vitals-series';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish, knowinglySkipped, skip, skipLayer } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const serverRoot = path.resolve(webRoot, '..', 'arsenal-server');
const tmpDir = path.join(here, 'tmp', 'scan-check');
const fixture = path.join(here, 'fixtures', 'demo-repo');

let skipAll = false;

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * 类清单与 layers 聚合的一致性判据（2026-10-17 夜跑棒 2）。
 *
 * 两边必须**同口径**：左边从 `code.classes` 现算（跳过 layer 为 null 的未分类条目），
 * 右边直接读 `code.layers` 聚合值。键集合与每个键的计数都要相等 ——
 * 多一个键、少一个键、计数差一，都是「同一趟输出内部漂移」。
 * 抽成函数是为了反向断言能复用同一份判据（喂一份改坏的副本必须判负）。
 */
function classLayerCounts(facts: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of facts?.code?.classes ?? []) {
    if (c.layer != null) out[c.layer] = (out[c.layer] ?? 0) + 1;
  }
  return out;
}

function layersAgg(facts: any): Record<string, number> {
  return facts?.code?.layers ?? {};
}

function sameLayerCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/** 在结构树里按路径找目录节点（找不到返回 null） */
function findDir(node: any, path: string): any | null {
  if (node.path === path) return node;
  for (const c of node.children ?? []) {
    const hit = findDir(c, path);
    if (hit) return hit;
  }
  return null;
}

/** 整棵树上挂的类总数（一条不丢的判据要能真数） */
function countTreeClasses(node: any): number {
  return (node.classes?.length ?? 0) + (node.children ?? []).reduce((n: number, c: any) => n + countTreeClasses(c), 0);
}

// ═══════════════════════════════════════════════════════════════
// 【0】环境：bash + JDK。缺一个就明说跳过，不装作通过
// ═══════════════════════════════════════════════════════════════
section('【0】依赖：bash + JDK17（后端扫描探针）');
const probeScript = path.join(serverRoot, 'scripts', 'scan-probe.sh');

/**
 * 探 bash。**「bash 不存在」与「本环境瞬时拒绝了 spawn」是两件事。**
 *
 * 2026-10-14 终检实测：`spawnSync('bash', ['--version'])` 在本 harness **时灵时不灵** ——
 * 同一份代码、同一个终端，四次里 3 次返回 `EBUSY`（1 次真跑通了 134/134）。
 * 老写法只看 `status === 0`，于是 EBUSY 被写成「bash 不可用」，
 * 后果是**整层 134 项记成「未执行」而实测数取自档案声明值** ——
 * 一句假话套着另一个假话：不是环境不具备，是这一层**一项都没测过**。
 * （10-12 铁律：「跑不动」和「没跑」不许写成同一句话，先探活再判断。）
 *
 * 所以：瞬时错误码重试 3 次；重试后仍被拒就**照实说是被拒**，
 * 并且不许把它写成「bash 不可用」。
 */
function probeBash(attempts = 3): { ok: boolean; transient: boolean; detail: string } {
  let detail = '';
  for (let i = 0; i < attempts; i++) {
    const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return { ok: true, transient: false, detail: '' };
    detail = (r.error as NodeJS.ErrnoException | undefined)?.code || `status=${r.status}`;
    if (detail !== 'EBUSY' && detail !== 'EAGAIN' && detail !== 'EPERM') {
      return { ok: false, transient: false, detail }; // ENOENT 之类才是真的没有
    }
  }
  return { ok: false, transient: true, detail };
}

const bashProbe = probeBash();
const hasBash = bashProbe.ok;
const hasProbe = fs.existsSync(probeScript);
let skipReason = '';
if (!hasBash || !hasProbe) {
  skipAll = true;
  skipReason = !hasBash
    ? bashProbe.transient
      ? `连续 ${3} 次 spawn bash 都被本环境瞬时拒绝（${bashProbe.detail}）—— `
        + '**这不是「bash 不可用」**，是这一层一次都没能起跑，下面 N 项全部未测'
      : `bash 不可用（spawnSync("bash","--version") 返回 ${bashProbe.detail}）—— 扫描探针跑不起来`
    : `探针脚本不存在：${probeScript}`;
  console.log(`  ! 跳过：${skipReason}`);
  console.log('    本层不会被计入「通过」。收尾会打「实测 N 项 / 跳过 M 项 / 失败 0 项」，退出码 2。');
}

// 探针回执。除 facts 外还有三种附加载荷（rules / symlink / guard）——
// 以前这里没声明，tsc 抓不到 `?.rules` 这类访问（.verify 不在类型闸门里）。
// 现在 .verify/tsconfig.json 把这一层也纳入了，所以字段必须写全。
type Receipt = {
  action: string;
  kind: string;
  ok: boolean;
  code?: string;
  message?: string;
  facts?: any;
  rules?: any;
  symlink?: any;
  guard?: any;
};

/**
 * 【9】解剖台那一节要用的事实。**不重新跑探针**（一次探针 4 分钟）——
 * 【1】拿到 factsA 时存到这里，【9】直接复用。
 */
let factsShared: any = null;

function runProbe(tag: string, actions: string[]): Receipt[] {
  const outFile = path.join(tmpDir, `${tag}.json`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const res = spawnSync('bash', [probeScript.replace(/\\/g, '/'), outFile.replace(/\\/g, '/'), ...actions], {
    cwd: serverRoot,
    encoding: 'utf8',
    timeout: 300_000,
  });
  if (res.status !== 0 || !fs.existsSync(outFile)) {
    console.log(`  [探针失败] ${res.stdout ?? ''}${res.stderr ?? ''}`.slice(0, 2000));
    return [];
  }
  return JSON.parse(fs.readFileSync(outFile, 'utf8')).receipts as Receipt[];
}

// ═══════════════════════════════════════════════════════════════
if (!skipAll) {
  // ── 【1】fixture 事实逐字段 ──────────────────────────────────
  section('【1】fixture 仓库（demo-repo）扫描结果逐字段');
  const r1 = runProbe('fixture-a', [
    `facts:${fixture.replace(/\\/g, '/')}`,
    'rules:',
  ]);
  const factsA = r1.find((r) => r.kind === 'facts')?.facts;
  factsShared = factsA ?? null; // 给【9】留一份，避免为同一份事实再跑一次探针
  const rules = r1.find((r) => r.kind === 'rules')?.rules;

  check('1-1 扫描成功返回 facts', !!factsA, JSON.stringify(r1).slice(0, 400));
  if (factsA) {
    check('1-2 build.kind === maven', factsA.build?.kind === 'maven', `实际 ${factsA.build?.kind}`);
    check('1-3 artifacts[0].javaVersion === 17', factsA.build?.artifacts?.[0]?.javaVersion === '17',
      `实际 ${JSON.stringify(factsA.build?.artifacts?.[0])}`);
    check('1-4 pom 依赖 9 个且每个都有 path+line',
      factsA.build?.dependencies?.length === 9
      && factsA.build.dependencies.every((d: any) => d.path && typeof d.line === 'number' && d.line > 0),
      `实际 ${factsA.build?.dependencies?.length}`);
    check('1-5 没写 version 的依赖是 null（不许填 0/1）',
      factsA.build.dependencies.filter((d: any) => d.artifact === 'spring-boot-starter-web')[0]?.version === null);

    const appYml = (factsA.config ?? []).find((c: any) => c.path === 'src/main/resources/application.yml');
    check('1-6 application.yml 的 server.port === 8080', appYml?.values?.['server.port'] === '8080',
      `实际 ${JSON.stringify(appYml?.values ?? null).slice(0, 200)}`);
    check('1-7 敏感值脱敏：spring.datasource.password === ***',
      appYml?.values?.['spring.datasource.password'] === '***',
      `实际 ${appYml?.values?.['spring.datasource.password']}`);
    const env = (factsA.config ?? []).find((c: any) => c.path.endsWith('.env'));
    check('1-8 .env 只留键名（值全是 ***）',
      !!env && Object.keys(env.values).length === 2 && Object.values(env.values).every((v) => v === '***'),
      `实际 ${JSON.stringify(env?.values ?? null)}`);

    // 按 kind 取，不按下标取：k8s 目录里现在还有 Service 与 ConfigMap，
    // 按 [0] 取等于把断言绑在文件名的字典序上（改个文件名就静默错位）
    const k8sDeployment = (factsA.deploy?.k8s ?? []).find((k: any) => k.kind === 'Deployment');
    check('1-9 K8s Deployment 的 replicas === 3', k8sDeployment?.replicas === 3,
      `实际 ${JSON.stringify(factsA.deploy?.k8s)}`);
    check('1-27 同目录下的 Service / ConfigMap 也被登记（不是只认 Deployment）',
      (factsA.deploy?.k8s ?? []).some((k: any) => k.kind === 'Service')
      && (factsA.deploy?.k8s ?? []).some((k: any) => k.kind === 'ConfigMap'),
      `实际 ${(factsA.deploy?.k8s ?? []).map((k: any) => k.kind).join(',')}`);
    const devYml = (factsA.config ?? []).find(
      (c: any) => c.path === 'src/main/resources/application-dev.yml'
    );
    check('1-28 第二份 profile 配置里的密码同样被脱敏',
      devYml?.values?.['spring.datasource.password'] === '***',
      `实际 ${JSON.stringify(devYml?.values ?? null)}`);
    check('1-29 @RestControllerAdvice 被识别（分层图横切关注点的依据）',
      factsA.code?.annotations?.['@RestControllerAdvice'] === 1,
      `实际 ${JSON.stringify(factsA.code?.annotations)}`);
    check('1-30 fixture 共 30 个文件全部被发现（含 22 层深目录之外的所有路径）',
      factsA.stats?.files === 30, `实际 ${factsA.stats?.files}`);
    check('1-10 helm values 的 replicaCount === 3',
      factsA.deploy?.helm?.some((h: any) => h.replicaCount === 3) === true,
      `实际 ${JSON.stringify(factsA.deploy?.helm)}`);
    check('1-11 Dockerfile 基础镜像与端口',
      factsA.deploy?.dockerfiles?.[0]?.baseImages?.[0] === 'eclipse-temurin:17-jre'
      && factsA.deploy.dockerfiles[0].exposedPorts?.[0] === 8080,
      `实际 ${JSON.stringify(factsA.deploy?.dockerfiles?.[0])}`);
    check('1-12 compose 三个服务 app/mysql/redis',
      ['app', 'mysql', 'redis'].every((s) => factsA.deploy?.compose?.[0]?.services?.includes(s)),
      `实际 ${JSON.stringify(factsA.deploy?.compose?.[0]?.services)}`);
    check('1-13 CI stages = build/test/deploy',
      JSON.stringify(factsA.deploy?.ci?.[0]?.stages) === JSON.stringify(['build', 'test', 'deploy']),
      `实际 ${JSON.stringify(factsA.deploy?.ci?.[0]?.stages)}`);

    check('1-14 code.annotations["@RestController"] === 3',
      factsA.code?.annotations?.['@RestController'] === 3,
      `实际 ${JSON.stringify(factsA.code?.annotations)}`);
    check('1-15 分层计数：controller 3 / service 1 / repository 1 / util 1（util 桶为 10-17 夜跑棒 2 新增：类名后缀 Utils/Util/Helper/Tools）',
      factsA.code?.layers?.controller === 3 && factsA.code?.layers?.service === 1
      && factsA.code?.layers?.repository === 1 && factsA.code?.layers?.util === 1,
      `实际 ${JSON.stringify(factsA.code?.layers)}`);
    check('1-16 Feign 客户端：kind=feign 且 target=inventory-service',
      factsA.code?.clientsUnique?.[0]?.kind === 'feign'
      && factsA.code?.clientsUnique?.[0]?.target === 'inventory-service',
      `实际 ${JSON.stringify(factsA.code?.clientsUnique)}`);
    check('1-17 路由带 handler 与行号',
      factsA.code?.routes?.length >= 4
      && factsA.code.routes.every((r: any) => r.handler?.includes('#') && r.line > 0),
      `实际 ${factsA.code?.routes?.length} 条`);
    check('1-18 跨带直连：OrderController → OrderRepository',
      factsA.code?.directCalls?.some((d: any) => d.from === 'OrderController' && d.to === 'OrderRepository') === true,
      `实际 ${JSON.stringify(factsA.code?.directCalls)}`);
    check('1-19 包只取前三层',
      factsA.code?.packages?.every((p: any) => p.path.split('/').length <= 3) === true,
      `实际 ${JSON.stringify(factsA.code?.packages)}`);

    // ── 类清单 / 目录计数 / util 桶（2026-10-17 夜跑棒 2：Java 信号提取）──────
    // 判据来自计划书 §6：① classes 与 layers 聚合逐键相等 ② util 标 layerBy=name
    // ③ 未分类不许猜 ④ dirs 与 stats.files 自洽。**每条都带样本量非零的前置**，
    // 防「空数组上 every() 恒真」这种静默通过。
    const cls: any[] = factsA.code?.classes ?? [];
    const dirsArr: any[] = factsA.code?.dirs ?? [];

    check('1-31 类清单形状：13 个 .java 文件 13 条，每条 name/file/line/package/layer/layerBy/annotations 七字段齐',
      cls.length === 13 && cls.every((c: any) =>
        typeof c.file === 'string' && c.file.endsWith('.java')
        && (c.name === null || typeof c.name === 'string')
        && (c.line === null || (typeof c.line === 'number' && c.line > 0))
        && (c.package === null || typeof c.package === 'string')
        && (c.layer === null || typeof c.layer === 'string')
        && (c.layerBy === null || typeof c.layerBy === 'string')
        && Array.isArray(c.annotations)),
      `实际 ${cls.length} 条`);

    check('1-32 一致性：Σ classes[].layer 逐层 === layers 聚合各键（双向——多一个键也是漂移）',
      sameLayerCounts(classLayerCounts(factsA), layersAgg(factsA)),
      `classes 现算 ${JSON.stringify(classLayerCounts(factsA))} vs layers ${JSON.stringify(layersAgg(factsA))}`);

    // 反向断言：删掉 StringUtils 那条后一致性必须判负 —— 证明 1-32 不是恒真摆设
    const dropped = JSON.parse(JSON.stringify(factsA));
    dropped.code.classes = dropped.code.classes.filter((c: any) => c.name !== 'StringUtils');
    check('1-33 反向断言：删掉 StringUtils 那条后一致性判负（证明 1-32 真的在比数据）',
      !sameLayerCounts(classLayerCounts(dropped), layersAgg(dropped)),
      '删了一条仍然相等 —— 1-32 的样本量或口径有问题');

    check('1-34 util 桶：StringUtils → layer=util 且 layerBy=name（命名推断，与徽标「据类名推断」角标同源）',
      cls.some((c: any) => c.name === 'StringUtils' && c.layer === 'util' && c.layerBy === 'name'),
      `实际 ${JSON.stringify(cls.find((c: any) => c.name === 'StringUtils') ?? null)}`);

    check('1-35 layers 键集精确等于 config/controller/domain/repository/service/util（行为变更钉死：只多 util 一个键）',
      JSON.stringify(Object.keys(layersAgg(factsA)).sort())
        === JSON.stringify(['config', 'controller', 'domain', 'repository', 'service', 'util']),
      `实际 ${JSON.stringify(Object.keys(layersAgg(factsA)).sort())}`);

    check('1-36 目录计数自洽：Σ dirs.files === stats.files（每个收集到的文件恰好属于一个目录）',
      dirsArr.length > 0 && dirsArr.reduce((n: number, d: any) => n + d.files, 0) === factsA.stats?.files,
      `Σ=${dirsArr.reduce((n: number, d: any) => n + d.files, 0)} vs stats.files=${factsA.stats?.files}`);

    check('1-37 根目录计数："" = 4 个文件（pom/Dockerfile/compose/gitlab-ci），com/demo/util = 1 个',
      dirsArr.find((d: any) => d.path === '')?.files === 4
      && dirsArr.find((d: any) => d.path === 'src/main/java/com/demo/util')?.files === 1,
      `实际 ${JSON.stringify(dirsArr.filter((d: any) => d.path === '' || d.path.endsWith('/util')))}`);

    check('1-38 三种 layerBy 出处都在真实数据里出现（annotation / name / package），且未分类桶非空',
      new Set(cls.map((c: any) => c.layerBy).filter((v: any) => v !== null)).size === 3
      && cls.filter((c: any) => c.layer === null).length > 0,
      `layerBy 集合 ${JSON.stringify([...new Set(cls.map((c: any) => c.layerBy))])}，未分类 ${cls.filter((c: any) => c.layer === null).length} 条`);

    const matched: any[] = factsA.techStack?.matched ?? [];
    check('1-20 技术栈命中 spring / mysql / redis',
      ['spring', 'mysql', 'redis'].every((t) => matched.some((m) => m.tech === t)),
      `实际 ${matched.map((m) => m.tech).join(',')}`);
    check('1-21 每条命中都有 evidence（path + line）',
      matched.length > 0 && matched.every((m) => (m.evidence ?? []).length > 0
        && m.evidence.every((e: any) => e.path && e.line > 0)));
    check('1-22 命中的都带上了架构图的 dim/opt（openfeign 除外）',
      matched.filter((m) => m.tech !== 'openfeign').every((m) => m.dim && m.opt),
      `实际 ${matched.map((m) => `${m.tech}:${m.dim}/${m.opt}`).join(',')}`);
    check('1-23 未命中依赖进 unmatched',
      factsA.techStack?.unmatched?.some((u: any) => u.artifact === 'weird-lib') === true,
      `实际 ${JSON.stringify(factsA.techStack?.unmatched)}`);
    check('1-24 未命中依赖在 notes 里有 UNMAPPED_DEPENDENCY',
      (factsA.notes ?? []).some((n: any) => n.code === 'UNMAPPED_DEPENDENCY' && n.message.includes('weird-lib')),
      `实际 ${JSON.stringify((factsA.notes ?? []).map((n: any) => n.code))}`);
    check('1-25 不存绝对路径：root 只是目录名，所有 path 都是相对路径',
      factsA.root === 'demo-repo'
      && !JSON.stringify(factsA).includes('D:\\')
      && !JSON.stringify(factsA).includes('D:/'),
      `实际 root=${factsA.root}`);
  }
  check('1-26 映射表 ≥80 条', (rules?.count ?? 0) >= 80, `实际 ${rules?.count}`);

  // ── 【1b】军火库自身真扫（2026-10-17 夜跑棒 2）─────────────────
  //
  // 判据要求「demo-repo fixture + 军火库自身真扫」两条真样本都过。
  // 扫的是 **arsenal-server 本体**而不是整仓：整仓扫会把【5】节留在 tmp 里的
  // 20001 文件测试库一起收进来，顶穿 MAX_FILES(20000) 被整次拒绝；而在校验脚本里
  // 清那个目录又会踩本机 safe-delete 的批量删除闸（>50 文件即拒，整个层被异常炸掉）。
  // arsenal-server 是 Java 事实源的主场（类清单 / 分层 / util 都出自它），
  // 且自带非 Java 文件（scripts / pom / resources）可验目录计数的全栈形状。
  //
  // 自身真扫**只查性质、不钉精确计数**（仓库在长大，钉死总数只会天天红）：
  // 一致性 / 目录自洽 / util 的 0 值结论 / 闸门跳过目录不泄漏。
  section('【1b】军火库自身真扫：classes / dirs / util');
  const repoRoot = path.resolve(webRoot, '..');
  const scanRoot = path.join(repoRoot, 'arsenal-server');
  const rSelf = runProbe('self', [`facts:${scanRoot.replace(/\\/g, '/')}`]);
  const selfFacts = rSelf.find((r) => r.kind === 'facts')?.facts;
  if (selfFacts) {
    const selfCls: any[] = selfFacts.code?.classes ?? [];
    const selfDirs: any[] = selfFacts.code?.dirs ?? [];
    check('1b-1 自身真扫：Σ classes[].layer 与 layers 逐键相等（样本量 > 0）',
      selfCls.length > 0 && sameLayerCounts(classLayerCounts(selfFacts), layersAgg(selfFacts)),
      `classes ${selfCls.length} 条；现算 ${JSON.stringify(classLayerCounts(selfFacts))}`
      + ` vs layers ${JSON.stringify(layersAgg(selfFacts))}`);

    check('1b-2 自身真扫：Σ dirs.files === stats.files（含 scripts / pom 等非 Java 文件）',
      selfDirs.length > 0 && selfDirs.reduce((n: number, d: any) => n + d.files, 0) === selfFacts.stats?.files,
      `Σ=${selfDirs.reduce((n: number, d: any) => n + d.files, 0)} vs stats.files=${selfFacts.stats?.files}`);

    // arsenal-server 自身没有 *Utils / *Util / *Helper / *Tools 类 —— util 计数为 0。
    // **0 也是结论**：这条钉的就是「真扫出来的 util 是 0，不是漏扫」
    const selfUtil = selfCls.filter((c: any) => c.layer === 'util');
    check('1b-3 自身真扫：util 计数为 0 且 layers 无 util 键（arsenal-server 自身没有工具类，0 也是结论）',
      selfUtil.length === 0 && !('util' in layersAgg(selfFacts)),
      `util ${selfUtil.length} 条；layers ${JSON.stringify(layersAgg(selfFacts))}`);

    // 闸门跳过目录不泄漏：arsenal-server/target 真实存在（726 个 .class），树里一条都不能有
    const skipNames = ['.git', 'node_modules', 'target', 'dist', 'build', 'out', '.next', 'bin', 'vendor', '__pycache__'];
    const existingSkips = skipNames.filter((n) => fs.existsSync(path.join(scanRoot, n)));
    const leaked = existingSkips.filter((n) => selfDirs.some((d: any) => d.path.split('/').includes(n)));
    check('1b-4 自身真扫：被 ScanGuard 跳过的目录不在树里（磁盘存在 target，树里泄漏 0 个）',
      existingSkips.includes('target') && leaked.length === 0,
      `磁盘存在 ${existingSkips.join(',')}；树里泄漏 ${leaked.join(',') || '无'}`);
  } else {
    check('1b-1 自身真扫拿到 facts', false, '探针没返回 arsenal-server 的 facts —— 这一组因此没测，不是通过');
  }

  // ── 【1c】项目结构派生层（code-structure.ts，2026-10-17 结构面板棒2）──
  //
  // 派生层是纯函数，判据全在 Java 侧（1-15 / 1b-1 已守 Σ classes ↔ layers）。
  // 这一节守的是**派生不漂**：组树不丢类、徽标带依据、词汇表与分层图同一套、
  // 0/空也是结论、判据不是恒真（反例自证）。
  section('【1c】项目结构派生层：组树 / 徽标 / 词汇表 / 空态');
  if (factsA) {
    const structA: CodeStructure = buildCodeStructure(factsA);
    const clsA: any[] = factsA.code?.classes ?? [];

    // ① 组树：约定节点在、根计数与 dirs 的 '' 条目对齐、类一条不丢
    const javaNode = findDir(structA.tree, 'src/main/java');
    const allDirFiles = (factsA.code?.dirs ?? []).reduce((s: number, d: any) => s + d.files, 0);
    check('1c-1 组树：src/main/java 约定节点在且子树带文件计数（中间目录 files=0 看 total）',
      !!javaNode && javaNode.total > 0 && structA.tree.total === allDirFiles,
      `java 节点 total=${javaNode?.total ?? '节点不在'}；根 total ${structA.tree.total} vs dirs 文件和 ${allDirFiles}`);
    const rootDir = (factsA.code?.dirs ?? []).find((d: any) => d.path === '');
    check('1c-2 组树：根节点直接文件数与 dirs 的 \'\' 条目相等',
      structA.tree.files === (rootDir?.files ?? -1),
      `树根 ${structA.tree.files} vs dirs[''] ${rootDir?.files ?? '缺失'}`);
    const treeClassCount = countTreeClasses(structA.tree);
    check('1c-3 组树：挂进树的类数 === facts classes 数（一条不丢）',
      treeClassCount === clsA.length, `树上 ${treeClassCount} vs facts ${clsA.length}`);

    // ② 一致性：七行（五带 + util + 未分类）计数之和 === 类总数；
    //    且五带 + util 的计数和 === layers 聚合各键和（派生不重算判据）
    const rowSum = structA.layers.reduce((n, r) => n + r.count, 0);
    check('1c-4 一致性：七行计数之和 === classes 总数',
      rowSum === structA.stats.classes && structA.stats.classes === clsA.length,
      `行和 ${rowSum} vs stats ${structA.stats.classes} vs facts ${clsA.length}`);
    const layerSum = Object.values(layersAgg(factsA)).reduce((a: number, b: any) => a + b, 0);
    const bandUtilSum = structA.layers
      .filter((r) => r.id !== 'unclassified')
      .reduce((n, r) => n + r.count, 0);
    check('1c-5 一致性：五带 + util 计数和 === layers 聚合和（未分类不进聚合，两层口径对齐）',
      bandUtilSum === layerSum, `派生 ${bandUtilSum} vs layers 聚合 ${layerSum}`);

    // ③ 徽标带依据：util 类必带「据类名推断」
    const utilCls = clsA.filter((c: any) => c.layer === 'util');
    check('1c-6 util 徽标：demo-repo 的 util 类据类名推断（layerBy=name，徽标全文带依据）',
      utilCls.length > 0 && utilCls.every((c: any) => c.layerBy === 'name')
      && utilCls.every((c: any) => classBadge(c) === '工具（据类名）'),
      `${utilCls.length} 个 util 类；徽标样本 ${utilCls[0] ? classBadge(utilCls[0]) : '无'}`);

    // ④ 未分类桶：判不出的单独列，不塞层
    const nullLayer = clsA.filter((c: any) => !c.layer);
    check('1c-7 未分类桶：计数与 facts 的 layer=null 类逐一相等，且桶里没有已分类类',
      structA.unclassified.length === nullLayer.length && nullLayer.length > 0
      && structA.unclassified.every((c: any) => !c.layer),
      `桶 ${structA.unclassified.length} 个 vs facts layer=null ${nullLayer.length} 个`);

    // ⑤ 空态：没有 Java 类 → 明说「未扫到 Java 类」，不是空树
    const emptyStruct = buildCodeStructure({
      ...factsA,
      code: { ...factsA.code, classes: [], layers: {} },
    });
    check('1c-8 空态：零 Java 类时明说「未扫到 Java 类」（0 也是结论，不是空树）',
      emptyStruct.stats.classes === 0
      && emptyStruct.notes.some((n) => n.includes('未扫到 Java 类')),
      emptyStruct.notes[0] ?? '无 notes');

    // ⑥ 确定性：同 facts 两跑逐字段相等
    check('1c-9 确定性：同一份 facts 派生两次逐字段相等',
      JSON.stringify(buildCodeStructure(factsA)) === JSON.stringify(structA),
      '两次不等 —— 树或徽标排序有不确定源');

    // ⑦ 词汇表单一出处：五带名与释义逐字等于 arch-layered（防第二套文案）
    const bandRows = structA.layers.filter((r) => (BAND_ORDER as string[]).includes(r.id));
    check('1c-10 词汇表：五带名与释义和 arch-layered 逐字相等（单一词汇表）',
      bandRows.length === BAND_ORDER.length
      && bandRows.every((r, i) => r.id === BAND_ORDER[i] && r.name === BAND_NAME[BAND_ORDER[i]]
        && r.desc === BAND_DESC[BAND_ORDER[i]]),
      bandRows.map((r) => `${r.id}=${r.name}`).join(' '));

    // ⑧ Markdown 导出：头部 stats + 层级释义 + 树 + 徽标依据都在
    const md = structureMarkdown(structA);
    check('1c-11 Markdown 导出：根名 / stats / 层级释义 / 目录树 / 徽标依据五样都在',
      md.includes(`# ${factsA.root} 项目结构`) && md.includes('## 层级释义')
      && md.includes('## 目录树') && md.includes('据类名') && md.includes('未分类'),
      `md ${md.length} 字符`);

    // ⑨ 反例自证（两条，各打一个判据）—— 恒真断言没有意义。
    //    A 打「七行覆盖」（1c-4）：塞一个判据外的 layer 值，
    //       它该掉出所有行（树里还在，行里没有）→ 行和比类总数少 1
    const unknownFacts = JSON.parse(JSON.stringify(factsA));
    unknownFacts.code.classes.push({
      name: 'MysteryBean', file: 'src/main/java/com/demo/MysteryBean.java', line: 1,
      package: 'com.demo', layer: 'mystery', layerBy: 'name', annotations: [],
    });
    const unknownStruct = buildCodeStructure(unknownFacts);
    const unknownRowSum = unknownStruct.layers.reduce((n, r) => n + r.count, 0);
    check('1c-12 反例自证 A：判据外 layer 值使「七行和 === 类总数」判负（覆盖不恒真）',
      rowSum === structA.stats.classes
      && unknownRowSum === unknownStruct.stats.classes - 1,
      `原状 ${rowSum}=${structA.stats.classes}；注入后七行和 ${unknownRowSum} vs 类总数 ${unknownStruct.stats.classes}（差 1 = 掉出所有行）`);
    //    B 打「派生↔layers 聚合」（1c-5）：只加类不改聚合，
    //       派生侧 +1、聚合侧不动 → 两边不等（聚合是 Java 侧另一份事实）
    const driftFacts = JSON.parse(JSON.stringify(factsA));
    driftFacts.code.classes.push({
      name: 'DriftService', file: 'src/main/java/com/demo/DriftService.java', line: 1,
      package: 'com.demo', layer: 'service', layerBy: 'name', annotations: [],
    });
    const driftStruct = buildCodeStructure(driftFacts);
    const driftBandUtilSum = driftStruct.layers
      .filter((r) => r.id !== 'unclassified')
      .reduce((n, r) => n + r.count, 0);
    check('1c-13 反例自证 B：只加类不改 layers 聚合使「派生↔聚合」判负（口径不恒真）',
      driftBandUtilSum === layerSum + 1,
      `派生 ${driftBandUtilSum} vs 聚合 ${layerSum}（聚合未动、派生 +1 → 判负正确）`);
  } else {
    check('1c-1 派生层拿到 factsA', false, 'fixture facts 没拿到 —— 这一组因此没测，不是通过');
  }
  if (selfFacts) {
    const structSelf: CodeStructure = buildCodeStructure(selfFacts);
    const rowSumSelf = structSelf.layers.reduce((n, r) => n + r.count, 0);
    check('1c-14 自身真扫同样过一致性：七行和 === 类总数，util 行为 0（0 也是结论）',
      rowSumSelf === structSelf.stats.classes
      && structSelf.layers.find((r) => r.id === 'util')?.count === 0
      && structSelf.notes.some((n) => n.includes('读过的文件')),
      `行和 ${rowSumSelf} vs 类总数 ${structSelf.stats.classes}`);
  }

  // ── 【2】确定性 ──────────────────────────────────────────────
  section('【2】确定性：同一份 fixture 扫两次');
  const r2 = runProbe('fixture-b', [`facts:${fixture.replace(/\\/g, '/')}`]);
  const factsB = r2.find((r) => r.kind === 'facts')?.facts;
  if (factsA && factsB) {
    const strip = (f: any) => {
      const c = JSON.parse(JSON.stringify(f));
      delete c.scannedAt;
      if (c.stats) delete c.stats.elapsedMs;
      return JSON.stringify(c);
    };
    check('2-1 除 scannedAt / elapsedMs 外逐字段相等', strip(factsA) === strip(factsB),
      '两次扫描结果不一致 —— 图会随机变');
    check('2-2 stats.files 稳定', factsA.stats?.files === factsB.stats?.files,
      `${factsA.stats?.files} vs ${factsB.stats?.files}`);
  } else {
    check('2-1 第二次扫描成功', false, '没拿到第二份 facts');
  }

  // ── 【3】恶意输入：闸门必须真的拦下 ──────────────────────────
  section('【3】恶意输入：安全闸门');
  const escapeZip = path.join(tmpDir, 'escape.zip').replace(/\\/g, '/');
  const largeZip = path.join(tmpDir, 'large.zip').replace(/\\/g, '/');
  runProbe('mkzip', [`mkzip-escape:${escapeZip}`, `mkzip-large:${largeZip}`]);
  const ATTACK_ACTIONS = [
    `zip:${escapeZip}`,
    `zip:${largeZip}`,
    'git:file:///c/Windows',
    'git:ssh://git@github.com/foo/bar.git',
    'git:git://github.com/foo/bar.git',
    'facts:../arsenal-web/不存在的目录',
  ];
  // 整批 attack 记录是否齐全(6 条都在 = 探针与后端的往返真实发生过)
  const attackGot = (rr: Receipt[]) =>
    ATTACK_ACTIONS.every((a) => {
      const i = a.indexOf(':');
      return rr.some((r) => r.kind === a.slice(0, i) && r.action.endsWith(a.slice(i + 1)));
    });
  let r3 = runProbe('attack', ATTACK_ACTIONS);
  if (!attackGot(r3)) {
    // 长跑链路偶发(2026-09-28 全量实测:1 项 → 6 项波动,单跑/直连始终正常):
    // 后端 JVM 在前几层探针负载下短暂停顿,Java 探针的 HTTP 全部落空,整批记录缺失。
    // 只对「记录缺失」重试一次 —— 真回归返回的是确定的错误记录,不会进这里,不掩盖。
    console.log('  ! attack 探针响应缺失(后端瞬时停顿?),2s 后重试一次');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    r3 = runProbe('attack-retry', ATTACK_ACTIONS);
  }
  const byAction = (kind: string, tail: string) =>
    r3.find((r) => r.kind === kind && r.action.endsWith(tail));

  const zEscape = byAction('zip', 'escape.zip');
  check('3-1 路径逃逸 zip（../escape.txt）被整体拒绝，错误码 SCAN_BAD_REQUEST',
    zEscape?.ok === false && zEscape?.code === 'SCAN_BAD_REQUEST',
    `实际 ok=${zEscape?.ok} code=${zEscape?.code} msg=${zEscape?.message}`);

  const zLarge = byAction('zip', 'large.zip');
  check('3-2 超大文件 zip 被拦（SCAN_TOO_LARGE）',
    zLarge?.ok === false && zLarge?.code === 'SCAN_TOO_LARGE',
    `实际 ok=${zLarge?.ok} code=${zLarge?.code} msg=${zLarge?.message}`);

  const gFile = byAction('git', 'file:///c/Windows');
  check('3-3 file:// git 地址被拒', gFile?.ok === false && gFile?.code === 'SCAN_BAD_REQUEST',
    `实际 ${gFile?.code}`);
  const gSsh = byAction('git', 'ssh://git@github.com/foo/bar.git');
  check('3-4 ssh:// git 地址被拒', gSsh?.ok === false && gSsh?.code === 'SCAN_BAD_REQUEST',
    `实际 ${gSsh?.code}`);
  const gGit = byAction('git', 'git://github.com/foo/bar.git');
  check('3-5 git:// git 地址被拒', gGit?.ok === false && gGit?.code === 'SCAN_BAD_REQUEST',
    `实际 ${gGit?.code}`);
  const badPath = byAction('facts', '不存在的目录');
  check('3-6 不存在的目录被拒（不是 500）', badPath?.ok === false && badPath?.code === 'SCAN_BAD_REQUEST',
    `实际 ${badPath?.code}`);

  // 软链接外跳：造不出来要如实说，不能当成「闸门生效」
  const linkDir = path.join(tmpDir, 'link-repo');
  fs.mkdirSync(linkDir, { recursive: true });
  const r4 = runProbe('symlink', [`mksymlink:${linkDir.replace(/\\/g, '/')}`]);
  const created = r4.find((r) => r.kind === 'mksymlink')?.symlink?.created === true;
  if (created) {
    const r5 = runProbe('symlink-scan', [`facts:${linkDir.replace(/\\/g, '/')}`]);
    const f = r5.find((r) => r.kind === 'facts')?.facts;
    check('3-7 软链外跳：仓库外目标文件没有被扫进来',
      !!f && !JSON.stringify(f).includes('top secret'), `实际 ${JSON.stringify(f?.config ?? [])}`);
  } else {
    // 造不出用例就**显式记跳过**，不是打一行日志了事：跳过是独立状态，进
    // 「实测 + 跳过」与声明项数比对。静默不跑会让这台机器上实测 92 ≠ 声明 93，
    // 换一台有权限的机器又变回 93 —— 层数账随环境漂移，而那正是记账要防的事。
    skip('3-7 软链外跳：仓库外目标文件没有被扫进来',
      '本机无法创建符号链接（Files.createSymbolicLink 失败：Windows 非管理员 / 未开开发者模式）—— 闸门未被这一条验证');
  }

  // ── 【4】三条出图链路：真实 facts → 三张图 ────────────────────
  //
  // 这一节是「扫得出来」到「画得出来」之间的守门人。全部用**探针扫出来的那份 facts**，
  // 不在 TS 里自造输入 —— 自造的输入只会验出「我们的代码能跑自己的输入」。
  section('【4】出图链路：facts → 部署图 / 分层图 / IR');
  if (factsA) {
    const built = buildTechArchFromFacts(factsA);
    const picks = built.picks;

    check('4-1 依赖映射落到画布槽位：web/cache/database/mq 都对上',
      picks.web === 'mvc' && picks.cache === 'redis' && picks.database === 'mysql' && picks.mq === 'kafka',
      JSON.stringify(picks));

    check('4-2 部署槽位由部署文件推出，且出处指向 fixture 里真实存在的文件',
      picks.deploy === 'helm' && picks.orchestration === 'k8s' && picks.ingress === 'nginx'
      && built.detail.fromDeploy.length >= 3
      && built.detail.fromDeploy.every((d) => fs.existsSync(path.join(fixture, d.because))),
      JSON.stringify(built.detail.fromDeploy));

    check('4-3 落图的依赖命中都带 evidence（没有出处的节点不许画）',
      built.detail.fromDeps.length >= 3
      && built.detail.fromDeps.every((d) => d.evidence.path.length > 0 && d.evidence.line > 0),
      JSON.stringify(built.detail.fromDeps));

    check('4-4 部署图节点齐：客户端 + 应用卡 + ≥3 个中间件节点',
      built.arch.nodes.some((n) => n.kind === 'client')
      && built.arch.nodes.some((n) => n.kind === 'app')
      && built.arch.nodes.filter((n) => n.kind === 'component' || n.kind === 'side').length >= 3,
      `实际 ${built.arch.nodes.map((n) => n.id + ':' + n.kind).join(',')}`);

    const app = built.arch.nodes.find((n) => n.kind === 'app');
    check('4-5 副本数取自 K8s 清单（3），读到了就说清出处',
      app?.modes?.[0]?.replicas === 3
      && built.notes.some((n) => n.includes('3') && n.includes('deployment.yaml')),
      JSON.stringify({ modes: app?.modes, notes: built.notes }));

    const svgs = CANVAS_THEME_OPTIONS.map((t) => buildTechArchSvg(built.arch, t.id, { title: 'x' }));
    check('4-6 五套主题渲染出的 SVG 互不相同（改了主题没变 = 配色没接上）',
      new Set(svgs).size === svgs.length,
      `len=${svgs.map((s) => s.length).join(',')}`);
    check('4-7 部署图 SVG 不含绝对路径',
      svgs.every((s) => !s.includes('D:\\') && !s.includes('D:/') && !s.includes('C:/')));

    const layered = buildLayeredArch(factsA, built.arch);
    check('4-8 分层图五带齐且顺序固定',
      layered.bands.map((b) => b.id).join(',') === 'client,api,app,domain,data',
      layered.bands.map((b) => b.id).join(','));
    check('4-9 接入层 3 个 Controller / 应用层 1 个 Service（与 facts 一致）',
      layered.bands.find((b) => b.id === 'api')?.total === 3
      && layered.bands.find((b) => b.id === 'app')?.total !== null,
      JSON.stringify(layered.bands.map((b) => `${b.id}=${b.total}`)));
    check('4-10 跨带直连抓到 OrderController → OrderRepository（红色警示线的依据）',
      layered.crossCalls.some((c) => c.fromClass === 'OrderController' && c.toClass === 'OrderRepository')
      && layered.crossCalls[0]?.from === 'api' && layered.crossCalls[0]?.to === 'data',
      JSON.stringify(layered.crossCalls));

    const lsvg = buildLayeredSvg(layered, 'doc');
    check('4-11 分层图 SVG 含五个带名与警示线图例',
      ['客户端', '接入层', '应用层', '领域层', '数据层'].every((n) => lsvg.includes(n))
      && lsvg.includes('跨带直连'),
      `bytes=${lsvg.length}`);

    const irRes = buildArchifyIrFromFacts(factsA);
    const shapeIssues = archifyIrShapeIssues(irRes.ir);
    const composeIssues = shapeIssues.length ? [] : archifyIrIssues(irRes.ir);
    check('4-12 facts → IR 过形状预检（0 问题）', shapeIssues.length === 0, JSON.stringify(shapeIssues));
    check('4-13 facts → IR 过现有九项构图预检（0 问题）', composeIssues.length === 0,
      JSON.stringify(composeIssues));
    check('4-14 IR 里有组件与阅读路径（不是一张空图）',
      irRes.ir.components.length >= 5 && (irRes.ir.meta.views ?? []).length >= 1,
      `components=${irRes.ir.components.length} views=${(irRes.ir.meta.views ?? []).length}`);

    const irA = JSON.stringify(buildArchifyIrFromFacts(factsA).ir);
    const irB = JSON.stringify(buildArchifyIrFromFacts(factsA).ir);
    check('4-15 确定性：同一份 facts 出两次 IR 逐字段相等', irA === irB);
    const sum = summarizeFacts(factsA);
    check('4-16 摘要里的未识别依赖带上出处',
      sum.unmatched.length === 1 && sum.unmatched[0].artifact === 'weird-lib' && sum.unmatched[0].where.includes('pom.xml:'),
      JSON.stringify(sum.unmatched));
  }

  // ── 【5】规模闸门：单文件 / 深度 / 文件数 ─────────────────────
  section('【5】规模闸门（单文件 2MB / 深度 20 / 文件数 2 万）');
  const bigRepo = path.join(tmpDir, 'big-repo').replace(/\\/g, '/');
  const deepRepo = path.join(tmpDir, 'deep-repo').replace(/\\/g, '/');
  const manyRepo = path.join(tmpDir, 'many-repo').replace(/\\/g, '/');
  const r6 = runProbe('guards', [
    `mkbigfile-repo:${bigRepo}`,
    `facts:${bigRepo}`,
    `mkdeep-repo:${deepRepo}`,
    `facts:${deepRepo}`,
    `mkfiles-repo:${manyRepo}`,
    `facts:${manyRepo}`,
  ]);
  const guardFacts = (tail: string) =>
    r6.find((r) => r.kind === 'facts' && r.action.endsWith(tail))?.facts;
  const guardReceipt = (tail: string) =>
    r6.find((r) => r.kind === 'facts' && r.action.endsWith(tail));

  const bigFacts = guardFacts('big-repo');
  check('5-1 单文件超 2MB：不读内容并留 FILE_TOO_LARGE，其余事实照常产出',
    (bigFacts?.notes ?? []).some((n: any) => n.code === 'FILE_TOO_LARGE')
    && bigFacts?.build?.kind === 'maven',
    JSON.stringify((bigFacts?.notes ?? []).map((n: any) => n.code)));

  const deepFacts = guardFacts('deep-repo');
  check('5-2 深度 22 层：截断并留 DEPTH_EXCEEDED + truncated:true（不许静默少读）',
    deepFacts?.stats?.truncated === true
    && (deepFacts?.notes ?? []).some((n: any) => n.code === 'DEPTH_EXCEEDED'),
    JSON.stringify({ truncated: deepFacts?.stats?.truncated, notes: (deepFacts?.notes ?? []).map((n: any) => n.code) }));

  const many = guardReceipt('many-repo');
  check('5-3 文件数 20001：整次扫描被拒且错误码是 SCAN_TOO_LARGE',
    many?.ok === false && many?.code === 'SCAN_TOO_LARGE',
    `实际 ok=${many?.ok} code=${many?.code}`);

  // 总字节 500MB 闸门：造 500MB 的用例代价太大（磁盘 + 时间），如实说没验。
  // ⚠️ 这是**刻意未跑**（不跑是决定，不是环境问题）→ 走 knowinglySkipped，
  // 与「想跑跑不了」的 skip 分开计数：它不进 skip/total（项的账不变），
  // 但会在总账里单列一行，且 `npm run verify -- --strict` 下判为失败。
  knowinglySkipped(
    '5-4 总字节 500MB 闸门的真实超限（造 500MB 用例）',
    '磁盘 + 时间代价过大。zip 那条路已有 SCAN_TOO_LARGE 断言（3-2）；8-2 断言了配置项值本身'
  );

  // ── 【6】没有任何部署清单的仓库：不许编出副本数 ─────────────────
  //
  // 这是全项目最容易被违反的一条底线（「读不到就默认 1」）。用真实扫出来的
  // big-repo（只有 pom.xml）验，不是自己造的 facts。
  section('【6】读不到就留空：无部署清单的仓库不编副本数');
  if (bigFacts) {
    const noDeploy = buildTechArchFromFacts(bigFacts);
    const appNoDeploy = noDeploy.arch.nodes.find((n) => n.kind === 'app');
    check('6-1 没有部署清单时不画副本数徽章（不是 1，是「没读到」）',
      appNoDeploy !== undefined && appNoDeploy.modes === undefined
      && noDeploy.notes.some((n) => n.includes('没有声明副本数')),
      JSON.stringify({ modes: appNoDeploy?.modes, notes: noDeploy.notes }));
  }
  // ── 【7】六视图档案草稿：读不到的必须留 TODO，且条数要说实话 ─────
  //
  // 这一节的断言都针对「草稿会不会把人带偏」：一份把 TODO 数成 0 的草稿，
  // 读的人会把没扫到的东西当成不存在；一份给数据存储写「单实例」的草稿，
  // 读的人会把我们编的部署形态当成事实。
  section('【7】六视图档案草稿（`/arch` 的「从代码生成」入口）');
  if (factsA) {
    const draft = buildProfileDraftFromFacts(factsA);
    check('7-1 草稿过档案形状校验（六视图齐 + 字段不缺 + token 可解）',
      draft.issues.length === 0, JSON.stringify(draft.issues));

    // 独立数一遍档案里真的带「TODO 」的条目 —— 被测代码按分支 push，这里按遍历数，
    // 两边口径不同才抓得住「漏 push 一条」这种错
    const inProfile: string[] = [];
    const walkTodo = (v: unknown, p: string) => {
      if (typeof v === 'string') {
        if (v.startsWith('TODO ')) inProfile.push(p);
      } else if (Array.isArray(v)) {
        v.forEach((x, i) => walkTodo(x, `${p}[${i}]`));
      } else if (v && typeof v === 'object') {
        Object.entries(v as Record<string, unknown>).forEach(([k, x]) => {
          if (k === 'note' || k === 'subtitle') return;
          walkTodo(x, p ? `${p}.${k}` : k);
        });
      }
    };
    walkTodo(draft.profile, '');
    check('7-2 「待补」条数说实话：列出来的条数 = 档案里真的带 TODO 的条数',
      inProfile.length > 0 && draft.todos.length === inProfile.length,
      `todos=${draft.todos.length} inProfile=${inProfile.length}`);

    check('7-3 草稿既不空也不假：有扫描填进去的真数据，也有留给人的待补',
      draft.filled > 0 && draft.todos.length > 0,
      `filled=${draft.filled} todos=${draft.todos.length}`);

    check('7-4 草稿里不出现 {{token}} —— 外部项目的度量平台算不出来，这是 token 机制唯一允许的例外',
      !JSON.stringify(draft.profile).includes('{{'));

    check('7-5 数据存储不许写「单实例」这种没读到的断言（读不到就写「副本数未声明」）',
      draft.profile.data.assets.every((a) => a.metric !== '单实例' && a.metric.length > 0),
      JSON.stringify(draft.profile.data.assets.map((a) => a.metric)));
  }

}

// ═══════════════════════════════════════════════════════════════
  // ── 【8】超时闸门：180s 上限必须存在且被读取；超时后错误码是 SCAN_TIMEOUT ──
  // 真等 180s 不现实，所以分两层验：① 配置项存在且被读取（TIMEOUT_MS 等常量）② 超期后
  // tick() 真的抛 SCAN_TIMEOUT。两条都能在「改小常量」时变红（见报告反着验）。
  if (!skipAll) {
    section('【8】超时闸门（总扫描 ≤180s）');
    const r8 = runProbe('guard-timeout', ['guard-info', 'guard-timeout']);
    const gi = r8.find((r) => r.kind === 'guard-info')?.guard;
    check('8-1 超时上限 TIMEOUT_MS === 180000（180s，配置项存在且被读取）',
      gi?.timeoutMs === 180000, `实际 timeoutMs=${gi?.timeoutMs}`);
    check('8-2 总字节上限 MAX_TOTAL_BYTES === 524288000（500MB，配置项存在且被读取）',
      gi?.maxTotalBytes === 524288000, `实际 maxTotalBytes=${gi?.maxTotalBytes}`);
    check('8-3 文件数上限 MAX_FILES === 20000（配置项存在且被读取）',
      gi?.maxFiles === 20000, `实际 maxFiles=${gi?.maxFiles}`);
    check('8-4 目录深度上限 MAX_DEPTH === 20（配置项存在且被读取）',
      gi?.maxDepth === 20, `实际 maxDepth=${gi?.maxDepth}`);
    const gt = r8.find((r) => r.kind === 'guard-timeout');
    check('8-5 超期后 tick() 抛 SCAN_TIMEOUT（超时后 code 正确，没真等 180s）',
      gt?.ok === false && gt?.code === 'SCAN_TIMEOUT',
      `实际 ok=${gt?.ok} code=${gt?.code}`);
    console.log('  ! 8-6 总字节 500MB 的真实超限（造 500MB 用例）与真等 180s 都未实跑：磁盘/时间代价过大。'
      + '只断言了配置项值与超时 code。文件数/深度/单文件都有真实超限用例（5-1/5-2/5-3）。');
    // 上面这句是给人看的；下面这条是给机器记账的（刻意未跑，见 A-9）
    knowinglySkipped(
      '8-6 真等 180s 超时（真实等待）',
      '等 180s 不现实。8-1/8-5 已断言配置项值与超期后 tick() 抛 SCAN_TIMEOUT 的 code'
    );
  }

// ═══════════════════════════════════════════════════════════════
// ── 【9】解剖台数据层（2026-10-11 夜跑棒 1）─────────────────────
//
// 解剖台（/autopsy）把原本写在 `CodeIntake.tsx` 里的 facts→图 链路抽成了
// `src/lib/autopsy-data.ts`，供解剖台与「从代码生成」面板共用。
// 抽这一类东西的风险不是抽错，而是**抽的时候顺手改了一点判据** ——
// 那之后 /archify 与 /autopsy 会各说各的，而两边都不会报错（memory 铁律 23）。
// 所以这一节守两件事：① 抽出来的那份与直算逐字段等价 ② 解剖台独有的三条结论
// （未识别依赖 / 覆盖率 / 路径解析对照）不许静默丢东西。
if (!skipAll && factsShared) {
  section('【9】解剖台数据层（autopsy-data.ts）');
  const factsA = factsShared;
  const aut = buildAutopsy(factsA, 'doc');

  // ① 等价性：把抽取前的实现照抄一遍逐字段对。
  //    只比对「会进图 / 会进装配台」的那几个字段 —— 比 SVG 字节更敏感：
  //    SVG 里改一个标题也能过，字段对不上就一定是判据变了。
  const raw = buildTechArchFromFacts(factsA);
  const rawLayered = buildLayeredArch(factsA, raw.arch);
  const rawSummary = summarizeFacts(factsA);
  const rawTitle = `${factsA.root} 技术架构图`;
  const rawSvg = buildTechArchSvg(raw.arch, 'doc', {
    title: rawTitle,
    subtitle:
      `由代码扫描生成 · ${rawSummary.files} 个文件 / ${raw.arch.nodes.length} 个节点 / ` +
      `${raw.arch.edges.length} 条连线 · ${rawSummary.techs.length} 项技术命中`,
  });
  check('9-1 抽数据层没改判据：buildAutopsy 与 facts-arch 直算逐字段相等（picks/arch/layered/summary/SVG）',
    JSON.stringify(aut.picksRes) === JSON.stringify(factsToPicks(factsA))
    && JSON.stringify(aut.built.arch) === JSON.stringify(raw.arch)
    && JSON.stringify(aut.layered) === JSON.stringify(rawLayered)
    && JSON.stringify(aut.summary) === JSON.stringify(rawSummary)
    && aut.techSvg === rawSvg
    && aut.title === rawTitle,
    `picks=${JSON.stringify(aut.picksRes.picks).slice(0, 160)}`);

  // ①b 服务拓扑同款：模型与图都必须能从 facts 直算复现（2026-10-12 棒 3 挂上面板）。
  //     topoSvg 与 techSvg 一样是字符串成品 —— 直算比对防的是「面板看到的图」
  //    与「facts 真实推导的图」静默分家。opts 走导出的 serviceGraphOpts：
  //    比对方与产物方必须传同一份标题/副标题，否则差一个字就红，而红的原因跟判据无关。
  const rawTopo = buildServiceTopo(factsA);
  const rawTopoSvg = buildServiceGraphSvg(rawTopo, 'doc', serviceGraphOpts(factsA, rawTopo));
  check('9-1b 服务拓扑产物可直算复现：topo 模型与 topoSvg 都与 facts 直算逐字节相等',
    JSON.stringify(aut.topo) === JSON.stringify(rawTopo)
    && aut.topoSvg === rawTopoSvg,
    `units=${aut.topo.counts.units} svgLen=${aut.topoSvg.length}`);

  // ② 未识别依赖：条数必须与 facts 里的 unmatched 一致（少一条 = 静默丢），
  //    且坐标不为空 —— 空坐标在页面上会渲染成一个没有名字的条目。
  const un = autopsyUnmatched(factsA);
  check('9-2 未识别依赖一条不落（条数 == facts.techStack.unmatched，坐标非空）',
    un.length === (factsA.techStack?.unmatched ?? []).length
    && un.every((u) => u.coord.length > 0 && u.group.length > 0 && u.artifact.length > 0),
    `实际 ${un.length} 条 / facts ${(factsA.techStack?.unmatched ?? []).length} 条`);

  // ③ 路径解析对照：填 A 扫到 B 必须能被发现（后端 toRealPath 会跟着符号链接走，
  //    而事实里只有目录名 —— 不对照的话「扫错了目录」永远没人知道）。
  const sameName = traceSource(`D:/somewhere/${factsA.root}`, factsA);
  const otherName = traceSource('D:/somewhere/totally-other', factsA);
  const zipLike = traceSource('D:/somewhere/totally-other', { ...factsA, sourceKind: 'zip' });
  check('9-3 路径解析对照：名字一致不报警、名字不一致报 diverged、zip 天然不同不误报',
    sameName.diverged === false && otherName.diverged === true && zipLike.diverged === false,
    JSON.stringify({ sameName: sameName.diverged, otherName: otherName.diverged, zip: zipLike.diverged }));

  // ④ 覆盖率与映射表规模必须从数据读 —— 写死 108 / 47 会在补映射那天开始撒谎。
  const cov = autopsyCoverage(factsA);
  check('9-4 映射表规模从同步产物读（与 scanStats 相等，不是写死的常量）',
    cov.ruleCount === scanStats().count && cov.ruleOnCanvas === scanStats().onCanvas && cov.ruleCount > 0,
    JSON.stringify(cov));

  // ⑤ 页面与数据层文件真的在 —— 「路由在、文件被删」时 /autopsy 会白屏，
  //    而没有任何一层会说话（project-check 只管 NAV ↔ 页面目录，不管容器拆成几个文件）。
  const autopsyFiles = [
    'src/app/autopsy/page.tsx',
    'src/app/autopsy/AutopsyLab.tsx',
    'src/app/autopsy/ArchPanel.tsx',
    'src/app/autopsy/UnmatchedPanel.tsx',
    'src/lib/autopsy-data.ts',
  ];
  const missing = autopsyFiles.filter((f) => !fs.existsSync(path.join(webRoot, f)));
  check(`9-5 解剖台 ${autopsyFiles.length} 个文件都在（页面壳 / 容器 / 两块面板 / 数据层）`,
    missing.length === 0, `缺失: ${missing.join('、')}`);

  // ⑥ 平行实现守门：解剖台不许自己再算一遍 picks —— 谁 import 了 factsToPicks
  //    而它又不是 facts-arch / autopsy-data / 校验层本身，就说明第三份出现了。
  const suspects = ['src/app/autopsy/AutopsyLab.tsx', 'src/app/autopsy/ArchPanel.tsx',
    'src/app/autopsy/ServicePanel.tsx',
    'src/app/autopsy/UnmatchedPanel.tsx', 'src/components/CodeIntake.tsx'];
  // 去注释后再判：本仓库的注释里会写「结论来自 buildAutopsy()」这种话，
  // 不去注释的话**任何** import 了 facts-arch 的文件都会因为注释里那句话被放过 ——
  // 判据就变成了摆设（2026-10-11 注入试验当场抓到：注入的平行 import 没让这条变红）。
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const parallel = suspects.filter((f) => {
    const s = stripComments(fs.readFileSync(path.join(webRoot, f), 'utf8'));
    return /from '@\/lib\/facts-arch'/.test(s) && !/buildAutopsy|autopsyUnmatched|autopsyCoverage/.test(s);
  });
  check('9-6 解剖台没有平行实现：四个消费方都走 autopsy-data，不各自 import facts-arch 重算',
    parallel.length === 0, `另有: ${parallel.join('、')}`);
}

// ═══════════════════════════════════════════════════════════════
// ── 【10】解剖台快照（2026-10-12 夜跑棒 3）───────────────────────
//
// 这一节守的是**持久化**，也是三个新检查里最容易被偷工减料的一类：
// 「看起来存了」和「真存了」在页面上长得一模一样，而它自己永远不会报错。
// 所以这一节全部是**真写盘、真读回、真注入坏数据**，没有一条比对的是源码文本
// （除了 10-4 / 10-8 那两条「不许有平行实现」的守门，那本来就只能是文本）。
{
  section('【10】解剖台快照：三档目录 / 指纹 / 存取 / 损坏 / 对照');

  const repoRoot = path.resolve(webRoot, '..');
  const snapshotDir = path.join(tmpDir, 'autopsy-store');

  /** 源码当数据断言 → 先去注释（本仓第三次栽在同一个坑上：注释里写了 readFileSync 就判红）。 */
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /**
   * 依赖外部进程的断言在 spawn 被拒时只能 `skip()` —— **绝不许兜成通过**：
   * 那会让「.gitignore 是否真生效」变成一条永远绿的摆设。
   *
   * 本 harness 里 `spawnSync` 对外部进程**会**返回 EBUSY，但那是**瞬时态** ——
   * 2026-10-14 终检实测：同一台机器同一条命令，四次里 3 次被拒、1 次跑通。
   * 所以这里也重试 3 次再下结论，且文案只写**实测到的**（返回了什么错误码），
   * 不写「沙箱限制」这种推断 —— 推断写进跳过理由，下一个人会当真。
   */
  const gitProbe = (() => {
    let detail = '';
    for (let i = 0; i < 3; i++) {
      const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return { ok: true, detail: '' };
      detail = (r.error as NodeJS.ErrnoException | undefined)?.code || `status=${r.status}`;
      if (detail !== 'EBUSY' && detail !== 'EAGAIN' && detail !== 'EPERM') break;
    }
    return { ok: false, detail };
  })();
  const spawnBroken = !gitProbe.ok;
  const spawnWhy = spawnBroken
    ? `连续 3 次 spawn git 都被本环境拒绝（${gitProbe.detail}）—— 这一条因此没测，不是「通过」`
    : '';

  // ① 三档目录必须真能换 —— 内联的 `??` 顺序写反时，整条链依然全绿（charter-dir 的教训）
  const dTier1 = resolveAutopsyDir({ webRoot, repoRoot });
  const dTier2 = resolveAutopsyDir({ webRoot, repoRoot, profileAutopsyDir: 'cfg/autopsy' });
  const dTier3 = resolveAutopsyDir({
    webRoot,
    repoRoot,
    profileAutopsyDir: 'cfg/autopsy',
    env: { ARSENAL_AUTOPSY_DIR: 'D:/tmp/env-autopsy' },
  });
  const dEmptyEnv = resolveAutopsyDir({
    webRoot,
    repoRoot,
    profileAutopsyDir: 'cfg/autopsy',
    env: { ARSENAL_AUTOPSY_DIR: '   ' },
  });
  check(
    '10-1 三档目录真生效：默认 → 档案 → 环境变量，且空串 env 退档而不是解析成仓库根',
    dTier1.tier === 1 &&
      dTier1.dir === path.join(webRoot, '.data', 'autopsy') &&
      dTier2.tier === 2 &&
      dTier2.dir === path.join(repoRoot, 'cfg', 'autopsy') &&
      dTier3.tier === 3 &&
      dTier3.dir === path.resolve('D:/tmp/env-autopsy') &&
      dEmptyEnv.tier === 2,
    JSON.stringify({ t1: dTier1.tier, t2: dTier2.tier, t3: dTier3.tier, empty: dEmptyEnv.tier })
  );

  // ② .gitignore 生效 —— 漏了它，别人的项目路径会被提交进军火库（profile-store 的老规矩）
  //    分两条：清单里有没有（永远能判）+ git check-ignore 认不认（要 spawn，环境不行就 skip）。
  //    必须分开记：合成一条会因 EBUSY 让「清单里有没有」这条也跟着失去证据。
  const giPath = path.join(repoRoot, '.gitignore');
  const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  const giHasPattern = /\*\*\/\.data\/autopsy\/|\.data\/autopsy\//.test(
    gi.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  );
  check(
    '10-2a .gitignore 里真的写了 .data/autopsy/ 这条（按名字忽略，改目录也不失效）',
    giHasPattern,
    `命中=${giHasPattern}`
  );
  const probeFile = path.join(webRoot, '.data', 'autopsy', 'zzz-probe.json');
  const ignored = spawnSync('git', ['check-ignore', '-q', probeFile], { cwd: repoRoot });
  if (spawnBroken) {
    skip('10-2b git check-ignore 真的把快照目录判为忽略', spawnWhy);
  } else {
    check('10-2b git check-ignore 真的把快照目录判为忽略', ignored.status === 0, `退出码=${ignored.status}`);
  }

  // ③ 目录指纹：稳定、且**改内容就变**（同 size 也要变 —— 靠 mtime）
  const treeRoot = path.join(tmpDir, 'tree');
  fs.rmSync(treeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(treeRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(treeRoot, 'src', 'A.java'), 'class A {}\n');
  fs.writeFileSync(path.join(treeRoot, 'pom.xml'), '<project/>\n');
  const tree1 = collectDirTree(treeRoot);
  const fp1 = fingerprintDirTree(tree1.entries);
  const fp1again = fingerprintDirTree(collectDirTree(treeRoot).entries);
  fs.writeFileSync(path.join(treeRoot, 'src', 'A.java'), 'class B {}\n'); // 同长度，只换一个字母
  const fp2 = fingerprintDirTree(collectDirTree(treeRoot).entries);
  check(
    '10-3 目录指纹：同目录两次一致；改一个字符（size 不变）指纹即变',
    fp1 === fp1again && fp1 !== fp2 && tree1.files === 2 && tree1.truncated === false,
    `files=${tree1.files} bytes=${tree1.bytes} ${fp1.slice(0, 8)} → ${fp2.slice(0, 8)}`
  );

  // ④ 「不许读全量内容」是硬规矩：一旦有人顺手 readFileSync，大仓库的指纹会比重扫还慢
  const fpSrcRaw = fs.readFileSync(path.join(webRoot, 'scripts', 'lib', 'autopsy-fingerprint.mjs'), 'utf8');
  // ⚠️ 这里**必须**去注释再判：文件头那段说明里正写着「逐文件 readFileSync 会把…变慢」，
  //    不去注释的话这条断言会因为一句注释而恒红（与 9-6 同款，本仓第三次）。
  const fpSrc = stripComments(fpSrcRaw);
  const srcFileHits = (fpSrc.match(/readFileSync|createReadStream/g) ?? []).length;
  check(
    '10-4 指纹不许读文件内容：autopsy-fingerprint.mjs 里没有 readFileSync / createReadStream（只用 stat）',
    srcFileHits === 0,
    `命中 ${srcFileHits} 处（未去注释时 ${(fpSrcRaw.match(/readFileSync/g) ?? []).length} 处 —— 差值就是注释里的）`
  );

  // ⑤ 存取往返 —— 真写盘、真读回
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  const pidA = projectIdOf('path', 'D:/demo-a');
  const mkFinding = (ruleId: string, file: string, line: number) => ({
    ruleId,
    title: `标题 ${ruleId}`,
    severity: 'MUST',
    category: 'style',
    file,
    line,
    column: 1,
    snippet: '***',
    message: '',
    collapsed: 0,
    evidence: `${file}:${line}`,
  });
  const mkReport = (p0: ReturnType<typeof mkFinding>[]) =>
    ({
      schemaVersion: 1,
      root: 'demo-a',
      sourceKind: 'path',
      elapsedMs: 12,
      scope: { files: 3, bytes: 30, truncated: false, rootName: 'demo-a', maxFiles: 20000, maxTotalBytes: 1 },
      coverage: {
        total: 69,
        executed: 42,
        notRun: 27,
        batches: 1,
        decidable: true,
        severityPool: {},
        tierPool: { p0: 50, p1: 18, other: 1 },
        skipped: [],
        skippedCount: 0,
        parseFailures: [],
        undecidability: [],
      },
      p0,
      p1: [],
      other: [],
      obs: {
        available: true,
        source: 'checkups.json',
        ruleCount: 6,
        items: [],
        unevaluated: [],
        firedCount: 0,
        unevaluatedCount: 0,
      },
    }) as unknown as AutopsyReport;

  const srcA = { kind: 'path' as const, value: 'D:/demo-a' };
  const snapA1 = buildSnapshot({ source: srcA, report: mkReport([mkFinding('R-1', 'a.java', 1), mkFinding('R-2', 'b.java', 2)]), now: new Date('2026-10-12T01:00:00Z') });
  const snapA2 = buildSnapshot({ source: srcA, report: mkReport([mkFinding('R-1', 'a.java', 1)]), now: new Date('2026-10-12T02:00:00Z') });
  const saved1 = saveSnapshotDisk({ dir: snapshotDir, snapshot: snapA1 });
  const saved2 = saveSnapshotDisk({ dir: snapshotDir, snapshot: snapA2 });
  const listed = listSnapshotsDisk({ dir: snapshotDir, projectId: pidA });
  const latest = loadLatestDisk({ dir: snapshotDir, projectId: pidA });
  check(
    '10-5 快照存取往返：save 2 份 → list 回 2 份 → loadLatest 是时间较新的那份',
    saved1.ok && saved2.ok && listed.snapshots.length === 2 && listed.damaged.length === 0 && (latest as { snapshotId: string })?.snapshotId === '20261012T020000Z',
    `listed=${listed.snapshots.length} damaged=${listed.damaged.length} latest=${(latest as { snapshotId?: string })?.snapshotId}`
  );
  // 现在两侧共用一个 projectIdOf（10-5 红过一次才改的），所以按快照自带 id 查也能查到 ——
  // 这条就是那条 bug 的回归闸：**按 id 查得到 + 别的项目查不到**。
  const listedByPid = listSnapshotsDisk({
    dir: snapshotDir,
    projectId: (snapA1 as unknown as { projectId: string }).projectId,
  });
  const otherPid = projectIdOf('path', 'D:/other');
  check(
    '10-6 快照按 projectId 分组：同项目查得到 2 份；别的项目查不到（两侧 id 必须同一个算法）',
    listedByPid.total === 2 &&
      listedByPid.snapshots.length === 2 &&
      loadLatestDisk({ dir: snapshotDir, projectId: otherPid }) === null &&
      otherPid !== (snapA1 as unknown as { projectId: string }).projectId,
    `total=${listedByPid.total} otherPid=${otherPid}`
  );

  // ⑥ 坏形状必须在**存的时候**就被挡下，而不是等读的时候崩
  const badMissingVerdict = saveSnapshotDisk({ dir: snapshotDir, snapshot: { ...snapA1, verdict: undefined } });
  const badKind = saveSnapshotDisk({ dir: snapshotDir, snapshot: { ...snapA1, snapshotId: '20261012T030000Z', source: { kind: 'ftp', value: 'x' } } });
  const badCount = saveSnapshotDisk({
    dir: snapshotDir,
    snapshot: { ...snapA1, snapshotId: '20261012T040000Z', verdict: { p0: 9, p1: 0, other: 0, obs: 0 } },
  });
  check(
    '10-7 坏快照存不进去：缺 verdict / kind 非法 / verdict 与 report 条数对不上，三处都挡',
    !badMissingVerdict.ok && !badKind.ok && !badCount.ok && listSnapshotsDisk({ dir: snapshotDir }).snapshots.length === 2,
    JSON.stringify({ a: badMissingVerdict.issues, b: badKind.issues, c: badCount.issues })
  );

  // ⑦ 磁盘上的 JSON 被人改坏 → 进 damaged，**不是抛异常、也不是当它不存在**
  const onDisk = fs.readdirSync(snapshotDir);
  const victim = path.join(snapshotDir, onDisk[0]);
  const victimBak = fs.readFileSync(victim, 'utf8');
  fs.writeFileSync(victim, '{"schemaVersion":1,"snapshotId":"坏了"');
  let threw = false;
  let afterBreak = { snapshots: [] as unknown[], damaged: [] as unknown[], total: 0 };
  try {
    afterBreak = listSnapshotsDisk({ dir: snapshotDir });
  } catch {
    threw = true;
  }
  const latestAfterBreak = loadLatestDisk({ dir: snapshotDir, projectId: pidA });
  fs.writeFileSync(victim, victimBak); // cp 还原，不用 git checkout
  check(
    '10-8 快照损坏不白屏：坏 JSON 进 damaged 列表，不抛异常，且不会被当成「最新」',
    !threw && afterBreak.damaged.length === 1 && afterBreak.snapshots.length === 1 && (latestAfterBreak as { snapshotId: string })?.snapshotId !== '坏了',
    `threw=${threw} damaged=${afterBreak.damaged.length} ok=${afterBreak.snapshots.length} latest=${(latestAfterBreak as { snapshotId?: string })?.snapshotId}`
  );

  // ⑧ 平行实现守门：形状校验只能有一份（浏览器与 Node 共用 autopsy-snapshot-shape.mjs）
  const snapTs = fs.readFileSync(path.join(webRoot, 'src', 'lib', 'autopsy-snapshot.ts'), 'utf8');
  const storeMjs = fs.readFileSync(path.join(webRoot, 'scripts', 'lib', 'autopsy-store.mjs'), 'utf8');
  check(
    '10-9 形状校验只有一份：TS 侧 import 共享的 .mjs，且两侧都不自带 schemaVersion 判据',
    /autopsy-snapshot-shape\.mjs/.test(snapTs) &&
      /autopsy-snapshot-shape\.mjs/.test(storeMjs) &&
      !/schemaVersion\s*!==/.test(snapTs) &&
      !/schemaVersion\s*!==/.test(storeMjs),
    `ts import=${/autopsy-snapshot-shape\.mjs/.test(snapTs)}`
  );

  // ⑨ L1 复用：同指纹命中、换指纹不命中
  const reuseHit = reusableSnapshot([snapA2, snapA1], snapA2.fingerprint);
  const reuseMiss = reusableSnapshot([snapA2, snapA1], 'report:other|1|1');
  check(
    '10-10 L1 复用按指纹命中：同指纹返回那一份，指纹不同返回 null（不是返回第一份）',
    reuseHit?.snapshotId === '20261012T020000Z' && reuseMiss === null,
    `hit=${reuseHit?.snapshotId} miss=${reuseMiss === null}`
  );

  // ⑩ 「P0 少了 1 个」必须有依据 —— 少了哪一条、在哪个文件第几行
  const d = diffSnapshots(snapA1, snapA2);
  const back = diffSnapshots(snapA2, snapA1);
  check(
    '10-11 对照差集：R-2 消失进 fixed 且带 evidence；反向比它进 added（不是只给数字）',
    d.p0.prev === 2 &&
      d.p0.next === 1 &&
      d.p0.fixed.length === 1 &&
      findingKey(d.p0.fixed[0]) === 'R-2@b.java:2' &&
      d.p0.added.length === 0 &&
      back.p0.added.length === 1 &&
      findingKey(back.p0.added[0]) === 'R-2@b.java:2',
    JSON.stringify({ prev: d.p0.prev, next: d.p0.next, fixed: d.p0.fixed.map(findingKey), added: back.p0.added.map(findingKey) })
  );

  // ⑩-b 空跑不许被当成「没变」：0 文件的指纹照样算得出来，长得跟正常指纹一样 ——
  //      放行它，页面就会拿「上次什么也没扫到」当「输入没变」来复用。
  const emptyReport = mkReport([]);
  const emptyTrust = fingerprintTrust({ ...emptyReport, scope: { ...emptyReport.scope, files: 0, bytes: 0 } });
  const truncTrust = fingerprintTrust({ ...emptyReport, scope: { ...emptyReport.scope, truncated: true } });
  const okTrust = fingerprintTrust(mkReport([mkFinding('R-9', 'z.java', 9)]));
  check(
    '10-15 指纹可信度闸门：0 文件 / 被截断 → 不可信（不许复用）；正常 → 可信',
    emptyTrust.trustworthy === false &&
      /一个文件都没扫到/.test(emptyTrust.reason) &&
      truncTrust.trustworthy === false &&
      okTrust.trustworthy === true,
    JSON.stringify({ empty: emptyTrust, trunc: truncTrust.reason, ok: okTrust })
  );

  // ⑩-c 快照里不许存凭据：git URL 里内嵌 `user:token@` 是私有仓库的常见写法，
  //      而快照要落盘、要被下载 —— 存进去等于把令牌写进一份会传阅的 JSON。
  const withToken = 'https://ci-bot:ghp_REALTOKEN123@github.com/o/r.git';
  const snapTok = buildSnapshot({
    source: { kind: 'git', value: withToken },
    report: mkReport([]),
    now: new Date('2026-10-12T05:00:00Z'),
  });
  const snapNoTok = buildSnapshot({
    source: { kind: 'git', value: 'https://github.com/o/r.git' },
    report: mkReport([]),
    now: new Date('2026-10-12T05:00:00Z'),
  });
  check(
    '10-16 快照不存凭据：URL 里的 token 被脱敏，且脱敏后与不带凭据的地址身份不同（不是同一份历史）',
    !JSON.stringify(snapTok).includes('ghp_REALTOKEN123') &&
      !JSON.stringify(snapTok).includes('ci-bot') &&
      /\*\*\*@/.test(snapTok.source.value) &&
      snapTok.projectId !== snapNoTok.projectId &&
      redactSourceValue(withToken) === 'https://***@github.com/o/r.git' &&
      projectIdOfSource({ kind: 'git', value: withToken }) === snapTok.projectId,
    `stored=${snapTok.source.value} pid=${snapTok.projectId}`
  );

  // ⑪-a git 指纹的**确定性**（不依赖 spawn）：同样的 (head, status) 必得同样的指纹，
  //    换个 head 必变 —— 不确定 = 每次都判「变了」= L1 永远不复用。
  const gA = fingerprintGitState({ head: 'a'.repeat(40), status: '' });
  const gAagain = fingerprintGitState({ head: 'a'.repeat(40), status: '' });
  const gB = fingerprintGitState({ head: 'b'.repeat(40), status: '' });
  const gDirty = fingerprintGitState({ head: 'a'.repeat(40), status: ' M x.java' });
  check(
    '10-12a git 指纹确定性：同输入同指纹；换 HEAD 变；有未提交改动也变（否则脏工作区会被判成没变）',
    gA === gAagain && gA !== gB && gA !== gDirty,
    `${gA.slice(0, 8)} / ${gB.slice(0, 8)} / ${gDirty.slice(0, 8)}`
  );

  // ⑪-b 真仓库读 HEAD（要 spawn git）
  const gs1 = readGitState(repoRoot);
  if (spawnBroken) {
    skip('10-12b 对本仓真能读出 40 位 HEAD 且两次一致', spawnWhy);
  } else {
    const gs2 = readGitState(repoRoot);
    check(
      '10-12b 对本仓真能读出 40 位 HEAD 且两次一致',
      gs1 !== null && gs2 !== null && gs1.head.length === 40 && fingerprintGitState(gs1) === fingerprintGitState(gs2),
      `head=${gs1?.head.slice(0, 8)}`
    );
  }

  // ⑫ 声称新建的文件真的在
  const newFiles = [
    'scripts/lib/autopsy-store.mjs',
    'scripts/lib/autopsy-fingerprint.mjs',
    'scripts/lib/autopsy-snapshot-shape.mjs',
    'src/lib/autopsy-snapshot.ts',
    'src/app/autopsy/HistoryPanel.tsx',
  ];
  const gone = newFiles.filter((f) => !fs.existsSync(path.join(webRoot, f)));
  check(`10-13 棒 3 新建的 ${newFiles.length} 个文件都在`, gone.length === 0, `缺失: ${gone.join('、')}`);

  // ⑬ 页面不许声称 100% 准确 —— 盲区必须写在 UI 里（这条是 2026-10-04「0 与没有长得一样」的同款）
  const historyTsx = fs.readFileSync(path.join(webRoot, 'src', 'app', 'autopsy', 'HistoryPanel.tsx'), 'utf8');
  check(
    '10-14 页面写明两件事：L2 增量未实现 + 指纹漏检的盲区（不许假装做到了）',
    /L2 增量未实现/.test(historyTsx) && /漏检/.test(historyTsx),
    `L2=${/L2 增量未实现/.test(historyTsx)} 盲区=${/漏检/.test(historyTsx)}`
  );

  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.rmSync(treeRoot, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════
// ── 【11】服务拓扑（2026-10-12 夜跑棒 2）────────────────────────
//
// 回答「**这个项目有几个服务**」—— 不是猜一个数字，而是每条服务声明带出处：
// 能精确合并的合并，合不了的说清，0/1 也是结论。判定全在 TS 纯函数
// `buildServiceTopo` 一份里（Java 侧只摊平 `facts.services.declarations`，
// 不做任何跨源关联 —— 10-04「判定逻辑两份实现」事故的防线）。
//
// 五个样本，全部**探针实扫**（含两个注入副本），没有一条在 TS 里手搓 facts：
//   ① services-demo   微服务正样本：4 compose + 3 篇 k8s 文档 + 4 入口
//   ② ghost-injected  ①的整目录副本 + 补上 ghost-service 的启动类 → 冲突必须消失
//   ③ demo-repo       单体（既有 fixture）→ 1 个入口说「单体特征」
//   ④ no-signal-repo  空信号 → 0 也是结论，且说清检查过哪些信号
//   ⑤ near-name-repo  order-service vs order-svc → 不得合并
//   ⑥ nested-root     ①的整目录塞进父目录再扫 —— 仓中仓布局（compose 在子目录、
//                      服务代码在同级子目录）。2026-10-12 棒 5 真扫军火库自身时
//                      发现 R1 只认入口路径第一段，这种布局下精确同名也归属失败，
//                      报 2 条假 declared-no-code 冲突；修复后以声明所在目录为根归属
if (!skipAll) {
  section('【11】服务拓扑：facts.services → 「这个项目有几个服务」');

  const fixtureSvc = path.join(here, 'fixtures', 'services-demo');
  const fixtureNear = path.join(here, 'fixtures', 'near-name-repo');
  const fixtureNoSignal = path.join(here, 'fixtures', 'no-signal-repo');
  const ghostRepo = path.join(tmpDir, 'ghost-injected');
  const win = (p: string) => p.replace(/\\/g, '/');

  // ② 的材料：services-demo 的**整目录副本**（只丢一个 java 文件进去是扫不出
  //    compose/k8s 的）+ 一个 ghost-service 的启动类。tmpDir 由收尾 hook 清掉。
  fs.rmSync(ghostRepo, { recursive: true, force: true });
  fs.cpSync(fixtureSvc, ghostRepo, { recursive: true });
  const ghostJava = path.join(
    ghostRepo, 'ghost-service', 'src', 'main', 'java', 'com', 'acme', 'ghost', 'GhostApplication.java'
  );
  fs.mkdirSync(path.dirname(ghostJava), { recursive: true });
  fs.writeFileSync(ghostJava, [
    'package com.acme.ghost;',
    '',
    'import org.springframework.boot.SpringApplication;',
    'import org.springframework.boot.autoconfigure.SpringBootApplication;',
    '',
    '/** 反向断言用：把 ghost-service 的代码补上，declared-no-code 冲突必须消失 */',
    '@SpringBootApplication',
    'public class GhostApplication {',
    '    public static void main(String[] args) {',
    '        SpringApplication.run(GhostApplication.class, args);',
    '    }',
    '}',
    '',
  ].join('\n'), 'utf8');

  // ⑥ 的材料：services-demo 整目录塞进父目录 nested-root/ 再扫 —— 仓中仓布局。
  //    修复前（R1 只认入口路径第一段）这种布局报 2 条假 declared-no-code 冲突：
  //    compose 明明在 services-demo/ 根下声明了 order-service，代码就在同级
  //    order-service/ 里，却因为第一段是 services-demo 而归属不上。
  const nestedRoot = path.join(tmpDir, 'nested-root');
  fs.rmSync(nestedRoot, { recursive: true, force: true });
  fs.cpSync(fixtureSvc, path.join(nestedRoot, 'services-demo'), { recursive: true });

  const svcActions = [
    `facts:${win(fixtureSvc)}`,
    `facts:${win(fixtureNear)}`,
    `facts:${win(fixtureNoSignal)}`,
    `facts:${win(ghostRepo)}`,
    `facts:${win(nestedRoot)}`,
    `facts:${win(fixture)}`, // demo-repo 单体
  ];
  let r11 = runProbe('svc-topo', svcActions);
  if (!r11.some((r) => r.kind === 'facts' && r.action.endsWith('services-demo'))) {
    // 与【3】同款：长跑链路里后端 JVM 会短暂停顿导致整批记录缺失。
    // 只对「记录缺失」重试一次 —— 真回归返回的是确定的错误记录，不会进这里。
    console.log('  ! 服务拓扑探针响应缺失（后端瞬时停顿?），2s 后重试一次');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    r11 = runProbe('svc-topo-retry', svcActions);
  }
  // 探针整体失败时 facts 退化为 {}：buildServiceTopo 不抛，断言逐条红并打出
  // 「实际 0 条」这类可读信息（runProbe 已把探针 stdout 打过一遍）。
  const factsOf = (tail: string): any =>
    r11.find((r) => r.kind === 'facts' && r.action.endsWith(tail))?.facts ?? {};
  const fSvc = factsOf('services-demo');
  const fNear = factsOf('near-name-repo');
  const fEmpty = factsOf('no-signal-repo');
  const fGhost = factsOf('ghost-injected');
  const fDemo = factsOf('demo-repo');
  const fNested = factsOf('nested-root');

  // ── ① 原始声明（Java 摊平层：只摊事实，不关联）────────────────
  const decl = fSvc.services?.declarations ?? [];
  check('11-1 摊平出 11 条声明：compose 4 / k8s 3 / code-entry 4（三源构成分开数，不合并成一个数）',
    decl.length === 11
    && decl.filter((d: any) => d.source === 'compose').length === 4
    && decl.filter((d: any) => d.source === 'k8s').length === 3
    && decl.filter((d: any) => d.source === 'code-entry').length === 4,
    `实际 ${decl.length} 条`);

  const svcDetails = (fSvc.deploy?.compose ?? [])[0]?.serviceDetails ?? [];
  const dOrder = svcDetails.find((d: any) => d.name === 'order-service');
  const dPay = svcDetails.find((d: any) => d.name === 'payment-service');
  const dMysql = svcDetails.find((d: any) => d.name === 'mysql');
  const dGhost = svcDetails.find((d: any) => d.name === 'ghost-service');
  check('11-2 compose 逐服务详情：4 空格缩进认得全、端口取容器侧、depends_on / image / build 各带行号',
    svcDetails.length === 4
    && dOrder?.line === 3 && dOrder?.port === 8080 && dOrder?.build === './order-service'
    && JSON.stringify(dOrder?.dependsOn) === JSON.stringify(['mysql'])
    && dPay?.line === 11 && dPay?.port === 8080
    && dMysql?.line === 14 && dMysql?.image === 'mysql:8.0' && dMysql?.port === null
    && dGhost?.line === 16 && dGhost?.build === './ghost-service' && dGhost?.port === null,
    JSON.stringify(svcDetails).slice(0, 400));

  const k8sDocs = fSvc.deploy?.k8s ?? [];
  const kOrder = k8sDocs.find((k: any) => k.name === 'order-service');
  const kPay = k8sDocs.find((k: any) => k.name === 'payment-service');
  const kSvcName = k8sDocs.find((k: any) => k.name === 'order-svc');
  check('11-3 k8s 多文档拆分：一个 all-in-one.yml 出 3 条，行号各指各的文档（2/22/40），副本与镜像都在',
    k8sDocs.length === 3
    && kOrder?.kind === 'Deployment' && kOrder?.line === 2 && kOrder?.replicas === 3
    && kOrder?.image === 'acme/order-service:1.4.0'
    && kPay?.kind === 'Deployment' && kPay?.line === 22 && kPay?.replicas === 2
    && kSvcName?.kind === 'Service' && kSvcName?.line === 40,
    JSON.stringify(k8sDocs.map((k: any) => `${k.kind}/${k.name}@${k.line}`)));

  const eps = fSvc.code?.entryPoints ?? [];
  check('11-4 可运行入口 4 个：@SpringBootApplication 3 + 裸 main 1（LegacyTool），都带 file/line/pkg',
    eps.length === 4
    && eps.filter((e: any) => e.runtime === 'spring-boot').length === 3
    && eps.filter((e: any) => e.runtime === 'main').length === 1
    && eps.every((e: any) => !!e.file && e.line > 0 && !!e.package)
    && eps.some((e: any) => e.className === 'LegacyTool' && e.runtime === 'main'),
    JSON.stringify(eps.map((e: any) => `${e.className}/${e.runtime}`)));

  // ── ② 微服务夹具：合并 / 分桶 / 边 / 冲突 ─────────────────────
  const tSvc = buildServiceTopo(fSvc);
  check('11-5 微服务 counts：各源分开报（compose 4 / k8s 负载 2 / 入口 4）+ 单元 5 + infra 1 + 非负载 1 + 边 2',
    JSON.stringify(tSvc.counts) === JSON.stringify({
      compose: 4, k8sWorkload: 2, codeEntry: 4, units: 5, infra: 1, nonWorkload: 1,
      unnamed: 0, edges: 2, externals: 0, unresolvedTargets: 1, unattributedRoutes: 0,
    }),
    JSON.stringify(tSvc.counts));

  const uOrder = tSvc.units.find((u: any) => u.name === 'order-service');
  const uPay = tSvc.units.find((u: any) => u.name === 'payment-service');
  check('11-6 order-service 单元：compose+k8s 两源合并、入口按目录名挂上、路由/Dockerfile/pom 都归属它',
    uOrder?.matchedOn === 'dir-name' && uOrder?.codeOnly === false
    && uOrder?.sources.map((s: any) => s.source).join('+') === 'compose+k8s'
    && uOrder?.entries.map((e: any) => e.className).join(',') === 'OrderApplication'
    && uOrder?.routes.length === 2
    && JSON.stringify(uOrder?.dockerfiles) === JSON.stringify(['order-service/Dockerfile'])
    && JSON.stringify(uOrder?.poms) === JSON.stringify(['order-service/pom.xml'])
    && uPay?.matchedOn === 'dir-name'
    && uPay?.sources.map((s: any) => s.source).join('+') === 'compose+k8s'
    && uPay?.entries.map((e: any) => e.className).join(',') === 'PaymentApplication'
    && uPay?.routes.length === 1
    && JSON.stringify(uPay?.poms) === JSON.stringify(['payment-service/pom.xml']),
    JSON.stringify({
      o: uOrder?.sources.map((s: any) => s.source),
      p: uPay?.sources.map((s: any) => s.source),
    }));

  const ghostC = tSvc.conflicts.find((c: any) => c.unit === 'ghost-service');
  check('11-7 ghost-service（compose 声明、无代码）进冲突清单：带 file:line 证据与「归属不上」的准确措辞',
    tSvc.conflicts.length === 1
    && ghostC?.kind === 'declared-no-code'
    && ghostC?.evidence.includes('docker-compose.yml:16')
    && /没有任何可运行入口、路由或构建文件能归属到它/.test(ghostC?.detail ?? ''),
    JSON.stringify(tSvc.conflicts));

  check('11-8 分桶不混进服务数：mysql 进 infra 带证据、order-svc 是 k8s Service 进 nonWorkload，units 里都没有',
    tSvc.infra.length === 1 && tSvc.infra[0]?.name === 'mysql'
    && tSvc.infra[0]?.evidence === 'docker-compose.yml:14'
    && tSvc.nonWorkload.length === 1 && tSvc.nonWorkload[0]?.name === 'order-svc'
    && tSvc.nonWorkload[0]?.kind === 'Service'
    && !tSvc.units.some((u: any) => u.name === 'mysql' || u.name === 'order-svc'),
    JSON.stringify({ infra: tSvc.infra, nonWorkload: tSvc.nonWorkload }));

  check('11-9 调用边两条（feign GatewayApplication→order-service、depends_on order-service→mysql）+ nginx ingress 一条',
    tSvc.edges.length === 2
    && tSvc.edges.some((e: any) => e.from === 'GatewayApplication' && e.to === 'order-service'
      && e.kind === 'feign' && e.evidence === 'gateway/src/main/java/com/acme/gateway/OrderClient.java:6')
    && tSvc.edges.some((e: any) => e.from === 'order-service' && e.to === 'mysql'
      && e.kind === 'depends_on' && e.evidence === 'docker-compose.yml:3')
    && tSvc.ingress.length === 1 && tSvc.ingress[0]?.unit === 'order-service'
    && tSvc.ingress[0]?.upstream === 'order-service:8081'
    && JSON.stringify(tSvc.ingressUnmatched) === JSON.stringify(['order_backend'])
    && tSvc.unresolvedTargets === 1,
    JSON.stringify({ edges: tSvc.edges, ingress: tSvc.ingress, unmatched: tSvc.ingressUnmatched }));

  check('11-10 未归属桶如实计数：路由 0 条归属不上；gateway 的 Dockerfile/pom 进桶（第一段 gateway 不是单元名）',
    tSvc.unattributed.routes.length === 0
    && JSON.stringify(tSvc.unattributed.dockerfiles) === JSON.stringify(['gateway/Dockerfile'])
    && JSON.stringify(tSvc.unattributed.poms) === JSON.stringify(['gateway/pom.xml']),
    JSON.stringify(tSvc.unattributed));

  check('11-11 确定性：同一份 facts 跑两次 buildServiceTopo 逐字段相等（否则面板会随机变）',
    JSON.stringify(buildServiceTopo(fSvc)) === JSON.stringify(buildServiceTopo(fSvc)));

  // ── ③ 反向断言：补上代码，冲突必须消失 ────────────────────────
  const tGhost = buildServiceTopo(fGhost);
  const uGhost = tGhost.units.find((u: any) => u.name === 'ghost-service');
  check('11-12 反向断言：补上 ghost-service 的代码后冲突消失、入口按目录名挂上（冲突不是写死的常数）',
    tGhost.conflicts.length === 0
    && uGhost?.matchedOn === 'dir-name'
    && uGhost?.entries.map((e: any) => e.className).join(',') === 'GhostApplication'
    && tGhost.counts.codeEntry === 5 && tGhost.counts.units === 5,
    JSON.stringify({ conflicts: tGhost.conflicts, entries: uGhost?.entries }));

  // ── ④ 单体夹具：1 个入口也是结论 ──────────────────────────────
  const tMono = buildServiceTopo(fDemo);
  check('11-13 单体夹具（demo-repo）：1 个可运行入口说「单体特征」；app/demo-app/DemoApplication 三个精确名各是各的单元',
    tMono.counts.codeEntry === 1
    && tMono.notes.some((n: string) => n.includes('单体特征'))
    && JSON.stringify(tMono.units.map((u: any) => u.name)) === JSON.stringify(['DemoApplication', 'app', 'demo-app'])
    && tMono.counts.infra === 2 && tMono.counts.nonWorkload === 3
    && tMono.units.find((u: any) => u.name === 'DemoApplication')?.routes.length === 5,
    JSON.stringify({ units: tMono.units.map((u: any) => u.name), counts: tMono.counts }));

  check('11-14 单体的部署声明也进冲突清单（app / demo-app 各一条），措辞是「归属不上」不是「仓库里找不到代码」',
    tMono.conflicts.length === 2
    && tMono.conflicts.every((c: any) => /没有任何可运行入口、路由或构建文件能归属到它/.test(c.detail))
    && tMono.conflicts.map((c: any) => c.unit).sort().join(',') === 'app,demo-app',
    JSON.stringify(tMono.conflicts.map((c: any) => `${c.unit}:${c.kind}`)));

  // ── ⑤ 空信号：0 也是结论 ──────────────────────────────────────
  const tEmpty = buildServiceTopo(fEmpty);
  check('11-15 空信号夹具：0 个单元，且 note 说清「检查过 compose 服务 / k8s 工作负载 / 代码可运行入口」',
    tEmpty.counts.units === 0 && tEmpty.counts.compose === 0 && tEmpty.counts.k8sWorkload === 0
    && tEmpty.counts.codeEntry === 0 && tEmpty.conflicts.length === 0
    && tEmpty.notes.some((n: string) => n.includes('未发现任何服务边界信号')
      && n.includes('compose 服务') && n.includes('k8s 工作负载') && n.includes('代码可运行入口')
      && n.includes('没有信号不等于没有服务')),
    JSON.stringify(tEmpty.notes));

  // ── ⑥ 近似名：不得合并 ────────────────────────────────────────
  const tNear = buildServiceTopo(fNear);
  check('11-16 近似名不合并：order-service 与 order-svc 是两个独立单元，入口各挂各的（精确匹配，不做名称归一化）',
    tNear.counts.units === 2
    && JSON.stringify(tNear.units.map((u: any) => u.name)) === JSON.stringify(['order-service', 'order-svc'])
    && tNear.units.find((u: any) => u.name === 'order-service')?.entries.map((e: any) => e.className).join(',') === 'OrderApp'
    && tNear.units.find((u: any) => u.name === 'order-svc')?.entries.map((e: any) => e.className).join(',') === 'SvcApp'
    && tNear.conflicts.length === 0 && tNear.counts.edges === 0,
    JSON.stringify(tNear.units.map((u: any) => u.name)));

  // ⑦ 外部调用也是边（2026-10-12 棒 3 目检实测补）：demo-repo 有 0 条声明之内的边、
  //    1 个 feign 指向声明之外的 inventory-service。三件事必须同时为真：
  //    模型带 from（否则渲染器只能画孤立节点，看页面的人无从知道它从哪来）、
  //    图画点线（样式即语义：depends_on 的 mysql 在本项目声明里，external 不在）、
  //    空态文案说「读到了、目标在声明之外」——旧文案「feign / depends_on / nginx
  //    都没读到」在这种情况下是假话（10-04 教训：视觉层验「说得对不对」）。
  const extSvg = buildServiceGraphSvg(tMono, 'doc', serviceGraphOpts(fDemo, tMono));
  const svcSvg = buildServiceGraphSvg(tSvc, 'doc', serviceGraphOpts(fSvc, tSvc));
  check('11-17 外部目标带 from 且画点线：模型有出处、图有线、空态不说「都没读到」的假话',
    tMono.externals.length === 1
    && tMono.externals[0]?.from === 'DemoApplication'
    && tMono.externals[0]?.target === 'inventory-service'
    && tMono.externals[0]?.kind === 'feign'
    && tMono.externals[0]?.evidence === 'src/main/java/com/demo/client/InventoryClient.java:6'
    && tMono.notes.some((n: string) => n.includes('DemoApplication→inventory-service'))
    && extSvg.includes('<title>inventory-service</title>')
    && extSvg.includes('<title>DemoApplication</title>')
    && extSvg.includes('stroke-dasharray="1 3"')
    && extSvg.includes('没有调用边') && extSvg.includes('声明之外')
    && !extSvg.includes('都没读到')
    // 反向：没有外部目标就不许出现点线（services-demo 只有 depends_on 的 5 4 虚线）
    && !svcSvg.includes('stroke-dasharray="1 3"') && svcSvg.includes('stroke-dasharray="5 4"'),
    `ext=${JSON.stringify(tMono.externals)} svgLen=${extSvg.length}`);

  // ⑧ 仓中仓布局（2026-10-12 棒 5 真扫自身暴露）：compose 在子目录、服务代码在
  //    同级子目录时，归属必须以**声明所在目录**为根 —— 只认入口路径第一段会把
  //    order-service / payment-service 误报成「声明了但没有代码」。这条断言在
  //    修复前是红的（2 条假冲突 + 2 个 codeOnly 副本单元），别把它当既有绿。
  const tNested = buildServiceTopo(fNested);
  const nOrder = tNested.units.find((u: any) => u.name === 'order-service');
  const nPay = tNested.units.find((u: any) => u.name === 'payment-service');
  check('11-18 仓中仓布局：声明所在目录为根归属，order-service/payment-service 挂上入口，冲突只剩 ghost-service',
    fNested.code?.entryPoints?.length === 4
    && nOrder?.matchedOn === 'dir-name' && nOrder?.codeOnly === false
    && nOrder?.entries.map((e: any) => e.className).join(',') === 'OrderApplication'
    && nOrder?.sources.map((s: any) => s.source).join('+') === 'compose+k8s'
    && nOrder?.dockerfiles.length === 1 && nOrder?.poms.length === 1
    && nPay?.matchedOn === 'dir-name' && nPay?.codeOnly === false
    && nPay?.entries.map((e: any) => e.className).join(',') === 'PaymentApplication'
    && tNested.conflicts.length === 1 && tNested.conflicts[0]?.unit === 'ghost-service'
    && tNested.counts.units === 5 && tNested.counts.codeEntry === 4,
    JSON.stringify({
      conflicts: tNested.conflicts.map((c: any) => c.unit),
      units: tNested.units.map((u: any) => `${u.name}${u.codeOnly ? '(codeOnly)' : ''}`),
      counts: tNested.counts,
    }));
}

// ═══════════════════════════════════════════════════════════════
// ── 【12】生命体征序列（2026-10-13 夜跑棒 1）──────────────────────
//
// 这一节是「多看几次」的地基：序列点落盘 → 读回 → 连成曲线 → 两点相减。
// 全部不依赖 bash / JDK（套件本身零依赖），所以放在 `if (!skipAll)` 之外 ——
// 探针挂了的机器上也必须能验这一节，否则「曲线读的是数据」这件事就没人守了。
{
  section('【12】生命体征序列：落点 / 读回 / 曲线 / 相减 / 坏行');

  const vitalsDir = path.join(tmpDir, 'vitals-store');
  const pid = 'pj-vitals-check';
  fs.rmSync(vitalsDir, { recursive: true, force: true });

  /** 构造一枚序列点（只用来喂断言，不经过后端 —— 后端那一路有【9】【10】守着）。 */
  const point = (n: number, over: Record<string, unknown> = {}) => ({
    schemaVersion: SERIES_SCHEMA_VERSION,
    snapshotId: newPointId(new Date(Date.UTC(2026, 9, 13, 15, n, 0))),
    ts: new Date(Date.UTC(2026, 9, 13, 15, n, 0)).toISOString(),
    fingerprint: `sha256:${n}`,
    fingerprintKind: 'dir' as const,
    fingerprintTrust: true,
    fingerprintCaveat: '',
    verdict: { p0: 12 - n, p1: 30, other: 0, obs: 8 },
    services: { declarations: 3, entryPoints: 2, units: null, conflicts: null },
    coverage: { executed: 42, total: 50 },
    scan: { files: 100 + n, bytes: 1234, ms: 90, truncated: false },
    status: 'full' as const,
    ...over,
  });

  // ① 同输入两次落点：除 ts / snapshotId 外逐字段相等 —— 曲线要是看到「同一个输入
  //    两次不一样」，后面所有「趋势」都不可信。
  const w1 = appendPoint({ dir: vitalsDir, projectId: pid, point: point(1) });
  const w2 = appendPoint({ dir: vitalsDir, projectId: pid, point: point(2) });
  const listed = listPoints({ dir: vitalsDir, projectId: pid });
  const [p1, p2] = listed.points;
  const strip = (o: Record<string, any>) => {
    const { ts, snapshotId, ...rest } = o;
    return rest;
  };
  check('12-1 序列点除 ts/snapshotId 外逐字段相等，且两次追加都读回校验通过',
    w1.ok && w1.verified === true && w2.ok && w2.verified === true
    && listed.points.length === 2 && listed.issues.length === 0
    && JSON.stringify(strip(p1)) === JSON.stringify(strip(point(1)))
    && JSON.stringify(strip(p2)) === JSON.stringify(strip(point(2)))
    && p1.ts < p2.ts,
    `points=${listed.points.length} verified=${w1.verified}/${w2.verified}`);

  // ② 曲线确定性：同输入两次逐字节相等。
  const asPoints = (arr: Record<string, any>[]) => arr as unknown as Parameters<typeof buildVitalsSeries>[0];
  const svgA = buildVitalsSeries(asPoints([p1, p2]));
  const svgB = buildVitalsSeries(asPoints([p1, p2]));
  check('12-2 曲线确定性：同输入两次 SVG 逐字节相等（不是「长度相等」）',
    svgA.svg === svgB.svg && svgA.svg.length > 0 && svgA.plotted === 2,
    `len=${svgA.svg.length}`);

  // ③ 空序列：不许画一张看起来健康的空图 —— svg 必须是空串，并且给出一句人话。
  const emptyRes = buildVitalsSeries([]);
  check('12-3 空序列不画假图：svg 为空串 + 一句「还没有序列数据」',
    emptyRes.empty === true && emptyRes.svg === '' && emptyRes.plotted === 0
    && emptyRes.message === EMPTY_SERIES_MESSAGE && !emptyRes.message.includes('正常'),
    `empty=${emptyRes.empty} svgLen=${emptyRes.svg.length} msg=${emptyRes.message}`);

  // ④ 单点：只画点，不画折线（一条点的「折线」是编出来的趋势）。
  const one = buildVitalsSeries(asPoints([p1]));
  const polyOne = (one.svg.match(/<polyline/g) ?? []).length;
  const dotOne = (one.svg.match(/<circle/g) ?? []).length;
  const twoPolys = (svgA.svg.match(/<polyline/g) ?? []).length;
  check('12-4 单点只画点不画折线：polyline=0 且 circle>0（两点时才有线）',
    polyOne === 0 && dotOne > 0 && twoPolys > 0,
    `单点 polyline=${polyOne} circle=${dotOne}；两点 polyline=${twoPolys}`);

  // ⑤ 两点相减：P0 从 12 变 10 → 「体检」段必须是 −2（**带前后两个数**，不是只给差）。
  //    依据那一路（哪一条规则修好了）归 diffSnapshots，这里比的是计数，两者不许混。
  const pA = point(0);
  const pB = { ...point(2), verdict: { p0: 10, p1: 30, other: 0, obs: 8 } };
  const d12 = diffPoints(pA, pB);
  const fmt12 = formatDiff(d12).join('\n');
  check('12-5 两点相减：体检段显示 12 → 10（−2），且依据来自明细级 diffSnapshots 而非另算',
    d12.checkup.p0.prev === 12 && d12.checkup.p0.next === 10 && d12.checkup.p0.delta === -2
    && fmt12.includes('12 → 10') && fmt12.includes('-2'),
    `delta=${d12.checkup.p0.delta} text=${fmt12.split('\n')[0]}`);

  // ⑥ partial 不进曲线：点数必须等于「总点数 − partial 数」。
  const withPartial = [point(1), point(2), { ...point(3), status: 'partial' as const }];
  const partialRes = buildVitalsSeries(withPartial as any);
  check('12-6 partial 不进曲线：plotted == 总点数 − partial 数，且被剔的原因写在结果里',
    withPartial.length === 3 && partialRes.plotted === 2 && partialRes.skippedPartial === 1,
    `plotted=${partialRes.plotted} skipped=${partialRes.skippedPartial}`);

  // ⑦ 坏行不许静默跳过：塞一行坏 JSON 后必须报 issues，且可用点数 < 文件行数。
  const seriesPath = seriesFile({ dir: vitalsDir, projectId: pid });
  fs.appendFileSync(seriesPath, '{这不是合法 JSON\n', 'utf8');
  fs.appendFileSync(seriesPath, `${JSON.stringify({ ...point(9), schemaVersion: 99 })}\n`, 'utf8');
  const afterBad = listPoints({ dir: vitalsDir, projectId: pid });
  check('12-7 坏行不许静默跳过：非 JSON 行与 schemaVersion 不符的行都进 issues，可用点数 < 行数',
    afterBad.issues.length === 2 && afterBad.lines === 4 && afterBad.points.length === 2
    && afterBad.issues[0].issues[0].includes('不是合法 JSON')
    && afterBad.issues[1].issues.some((s: string) => s.includes('schemaVersion')),
    `lines=${afterBad.lines} points=${afterBad.points.length} issues=${afterBad.issues.map((i: any) => i.line).join(',')}`);

  // ⑧ 覆盖率分母从数据读：同一批分子、分母 50 → 69，曲线的分母与文字都要跟着变；
  //    写死 69 的实现在这条断言上永远是绿的，所以必须**双向**都验。
  const cov50 = buildVitalsSeries([{ ...point(1), coverage: { executed: 42, total: 50 } }]);
  const cov69 = buildVitalsSeries([{ ...point(1), coverage: { executed: 42, total: 69 } }]);
  check('12-8 覆盖率分母从数据读（50 与 69 两种数据给出两种分母，不出现写死的 69）',
    cov50.coverageTotal === 50 && cov69.coverageTotal === 69
    && cov50.lines[2].values[0] === 84 && Math.abs((cov69.lines[2].values[0] ?? 0) - 60.87) < 0.02,
    `cov50=${cov50.coverageTotal}/${cov50.lines[2].values[0]} cov69=${cov69.coverageTotal}/${cov69.lines[2].values[0]}`);
}

// ═══════════════════════════════════════════════════════════════
// 【13】活体对账（2026-10-13 夜跑棒 2）
// ═══════════════════════════════════════════════════════════════
//
// 「静态声明的，运行时是不是真的」这第一次有了断言。
//
// 分两截，与【12】同款理由：
//   13-A ~ 13-E 纯函数（不碰 bash/JDK，放 skipAll 之外）—— 对账判据是最该守的东西，
//                       不能因为探针挂了就没人守；
//   13-1 ~ 13-7 真跑（要 bash + JDK + .m2），放 if (!skipAll) 里。
//
// 本棒三个高发静默失败，逐条有断言盯着：
//   ① 采集返回 not-executed 被当成「正常」→ 13-A / 13-3
//   ② 进程没杀干净但断言空跑通过       → 13-2（拿日志里的真 PID 去查，不是数进程总数）
//   ③ 断言通过但样本量为 0             → 13-1 明验 port/health 都有值，13-D 明验 0 入口时 rows 非空
/** 一份带一个 spring-boot 入口的最小 facts。真跑那一段（13-7）也要用，所以提到块外 */
const factsWithEntry = {
  code: {
    entryPoints: [
      { file: 'src/main/java/demo/DemoApplication.java', line: 12, package: 'demo', className: 'DemoApplication', runtime: 'spring-boot' },
    ],
  },
  config: [],
} as any;

{
  section('【13】活体对账：纯函数部分（不依赖 bash/JDK）');

  /** 喂断言的运行时事实（不经过后端 —— 后端那一路在 13-1 真跑里验） */
  const probeOk = (over: Record<string, unknown> = {}): RuntimeProbeFact =>
    ({
      runtime: 'spring-boot',
      supported: true,
      mainClass: 'demo.DemoApplication',
      bootVersion: '4.1.1',
      status: 'executed',
      reason: '',
      process: { status: 'ok', stoppedBy: 'signal', exitCode: 1, elapsedMs: 3800, truncated: false },
      port: {
        value: 60123,
        source: 'startup-log',
        evidence: { stream: 'stdout', line: 18, text: "Tomcat started on port 60123 (http)" },
      },
      health: { endpoint: '/actuator/health', probed: true, httpStatus: 200, body: '{"status":"UP"}' },
      log: { stdoutLines: 19, stderrLines: 0, tail: [], errors: [] },
      missingDeps: [],
      ...over,
    }) as unknown as RuntimeProbeFact;

  // ① 没有采集结果 —— 必须是 not-run + reason 非空，且摘要把「未执行」说出来
  const reconNone = reconcileRuntime(factsWithEntry, [null]);
  const entryNone = reconNone.rows.find((r) => r.kind === 'entry')!;
  check('13-A 没有运行时采集结果 → verdict=not-run 且 reason 非空、摘要明说「未执行」',
    entryNone.verdict === 'not-run'
    && entryNone.reason.includes('没跑')
    && reconNone.counts.notRun >= 1
    && reconNone.summary.includes('未执行')
    && reconNone.notRunReasons.length >= 1,
    `verdict=${entryNone.verdict} notRun=${reconNone.counts.notRun} summary=${reconNone.summary.slice(0, 60)}`);

  // ② 起不来 —— 必须是 mismatch（不是 not-run，更不是 match），且**不许出现「健康」「正常」字样**
  const reconBroken = reconcileRuntime(factsWithEntry, [
    { ...probeOk(), status: 'not-executed', reason: '编译不过 —— BrokenApplication.java:13: 需要\';\'', port: null, health: { probed: false, note: '没探到' } },
  ]);
  const entryBroken = reconBroken.rows.find((r) => r.kind === 'entry')!;
  const healthBroken = reconBroken.rows.find((r) => r.kind === 'health')!;
  // 只看「结论字段」（verdict + reason）里有没有肯定的「健康/正常」。
  // 不能拿整份 JSON 去 substring —— summary 里本来就有「不是「没问题」」这种**否定**表述，
  // 拿整串去查会把自己的正确措辞判成错误，而真正的问题（reason 里写「健康」）反而查不出来。
  const brokenClaims = reconBroken.rows.map((r) => `${r.verdict}|${r.reason}`).join(' ');
  check('13-B 起不来的工程 → verdict=mismatch + reason 说清原因，且没有任何一条结论声称「健康 / 正常」',
    entryBroken.verdict === 'mismatch'
    && entryBroken.reason.includes('编译不过')
    && healthBroken.verdict !== 'match'
    && !brokenClaims.includes('健康')
    && !brokenClaims.includes('正常'),
    `verdict=${entryBroken.verdict} health=${healthBroken.verdict} reason=${entryBroken.reason.slice(0, 40)}`);

  // ③ 三问全成立 —— 三条 match，且每条两侧都有证据
  // 端口这一问要 match，静态声明必须就等于实际监听值（60123）。
  // 写 '0' 的话会走「采集姿势导致的偏差」分支 —— 那是 mismatch，验不到 match 这条路。
  const reconOk = reconcileRuntime(
    { ...factsWithEntry, config: [{ path: 'src/main/resources/application.properties', keys: ['server.port'], values: { 'server.port': '60123' } }] } as any,
    [probeOk()],
  );
  const allMatch = reconOk.rows.filter((r) => r.verdict === 'match');
  check('13-C 三问全成立 → 三条 match，且每条两侧证据都在（静态 file:line + 运行时日志行号/HTTP）',
    allMatch.length === 3
    && reconOk.rows.every((r) => r.staticEvidence !== null || r.runtimeEvidence !== null)
    && reconOk.rows.filter((r) => r.kind === 'entry').every((r) => r.staticEvidence?.file.includes('DemoApplication')
        && r.runtimeEvidence?.line === 18)
    && reconOk.started === 1,
    `match=${allMatch.length}/${reconOk.rows.length} started=${reconOk.started}`);

  // ④ 0 个入口 —— 不许是空表，也不许是一句「一切正常」
  const reconZero = reconcileRuntime({ code: { entryPoints: [] }, config: [] } as any, []);
  check('13-D 0 个入口时 rows 非空、摘要明说「没有可运行入口」（0 的情况本身是一条结论）',
    reconZero.rows.length >= 3
    && reconZero.declared === 0
    && reconZero.summary.includes('没有可运行入口')
    && reconZero.notRunReasons.length >= 1,
    `rows=${reconZero.rows.length} summary=${reconZero.summary.slice(0, 50)}`);

  // ⑤ 静态端口读不到 → 返回 null，不是「默认 8080」。猜出来的端口不许进对账表
  check('13-E 静态端口读不到 → declaredPort 返回 null（不是默认 8080）',
    declaredPort({ config: [] } as any) === null
    && declaredPort(null) === null
    && declaredPort({ config: [{ path: 'a.properties', keys: [], values: { 'server.port': '8081' } }] } as any)?.port === 8081,
    `空=${declaredPort({ config: [] } as any)} 有值=${declaredPort({ config: [{ path: 'a', keys: [], values: { 'server.port': '8081' } }] } as any)?.port}`);

  // ⑥ 没探到 health → 对账 verdict 绝不能是 match（「没探」被当成「健康」是最坏的一种静默失败）。
  //    措辞里出现「健康」字样没关系（原文是「……不是『健康』」这种否定），
  //    **verdict 是 match** 才是真出事了。
  const noActuator = { ...probeOk(), health: { probed: false, note: 'classpath 里没有 spring-boot-actuator —— 这是「无 health 端点」，不是「健康」' } };
  const reconNoAct = reconcileRuntime(factsWithEntry, [noActuator]);
  const healthNoAct = reconNoAct.rows.find((r) => r.kind === 'health')!;
  check('13-F 没探到 health → 对账 verdict 是 not-run（不是 match），措辞带「无 health 端点」；探到的那条措辞带 UP',
    healthNoAct.verdict === 'not-run'
    && healthWording(noActuator).includes('无 health 端点')
    && healthWording(probeOk()).includes('UP'),
    `verdict=${healthNoAct.verdict} 措辞=${healthWording(noActuator).slice(0, 28)}`);

  // ⑦ 「没采」不许被说成「健康」——**这条是被真实注入打出来的**，不是想出来的。
  //    2026-10-14 终检注入 `healthWording(null) → '健康'` 时 13-A / 13-B / 13-F **三条全绿**：
  //    它们守的是 reconcile 产出的 rows 与 verdict，而 `healthWording` 的 null 分支
  //    在 reconcile 路径上**根本走不到**（调用前已判过 probeForHealth 非空）。
  //    → 措辞层是一个独立的出口，必须有断言直接打它，否则改坏了没人知道。
  //    判据用「肯定句」而不是 substring：措辞里出现「不是健康」这种否定表述是**正确**的，
  //    拿 substring 去查会把自己的好话判成错。
  const stripNegated = (w: string) =>
    // 做法：先把「不是/并非/没有…健康|正常」这类**否定式**整段抠掉，剩下的是「肯定地说它健康」。
    // （第一版把方向写反了：`!NEGATED.test(w)` 会把「不是健康」判成错、真正的「就是健康」放行。
    //   判据方向写反和没写这条断言长得一模一样 —— 都是绿的。所以判据写完必须反着验一次。）
    w.replace(/(不是|并非|没有|没|未|≠)[^。；;]{0,6}(健康|正常)/g, '');
  const emptyWordings = [
    healthWording(null),
    healthWording(undefined),
    healthWording({} as RuntimeProbeFact),
  ];
  const emptyOk = emptyWordings.every((w) =>
    (w.includes('没采') || w.includes('没有') || w.includes('没探'))
    && !stripNegated(w).includes('健康')
    && !stripNegated(w).includes('正常'));
  check('13-G 没采集结果时 healthWording 不许说「健康 / 正常」（措辞层单独守，不靠 verdict 顺带覆盖）',
    emptyOk,
    `三处措辞：${emptyWordings.map((w) => w.slice(0, 18)).join(' | ')}`);

  // ⑧ 第六页签真的挂上了吗 —— 端点、面板、页签三处一起看。
  //    2026-10-13 棒 2 的教训：后端端点建好了、纯函数写好了、断言全绿了，
  //    但页签没做 → 「用户一点都看不到」。纯函数绿 ≠ 页面在。
  const labSrc = fs.readFileSync(path.join(webRoot, 'src/app/autopsy/AutopsyLab.tsx'), 'utf8');
  const panelSrc = fs.existsSync(path.join(webRoot, 'src/app/autopsy/RuntimePanel.tsx'))
    ? fs.readFileSync(path.join(webRoot, 'src/app/autopsy/RuntimePanel.tsx'), 'utf8')
    : '';
  const ctrlSrc = fs.readFileSync(
    path.join(serverRoot, 'src/main/java/com/arsenal/web/AutopsyController.java'), 'utf8');
  // 从面板源码里**抠出**档位字样表，而不是在本仓再抄一份 ——
  // 抄一份的话，改了页面忘改断言，13-I 会一直绿而页面已经变了。
  const VERDICT_TEXT_SRC =
    panelSrc.match(/const VERDICT_TEXT[^=]*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const tabIds = (labSrc.match(/\['(arch|services|checkup|history|vitals|runtime)',/g) ?? []);
  check('13-H 第六页签真挂上：tab 数组含 runtime + 渲染分支 + 面板文件 + 后端 /run 端点',
    tabIds.length >= 6
    && new Set(tabIds).size === 6
    && labSrc.includes("tab === 'runtime'")
    && panelSrc.length > 0
    && /reconcileRuntime/.test(panelSrc)
    && /VERDICT_TEXT/.test(panelSrc)
    && ctrlSrc.includes('@PostMapping("/run")'),
    `tab 项=${tabIds.length} 面板=${panelSrc.length}字端点=${ctrlSrc.includes('@PostMapping("/run")')}`);

  // ⑨ 三档措辞不许只有颜色 —— 页面上必须带字（色盲 / 单色截图 / 打印都靠它）。
  //    键名要带引号一起匹配：`'not-run': '未执行'` 里 `not-run:` 根本不是合法的 key 形态，
  //    按 `not-run:` 去 match 会静默匹配不到，然后这条断言靠 fallback 分支假装通过。
  const verdictEntries = [...VERDICT_TEXT_SRC.matchAll(/'?([a-z][a-z-]*)'?:\s*'([^']*)'/g)]
    .map((m) => [m[1], m[2]] as const);
  check('13-I 三档 verdict 各自带中文档位字样（不许只靠颜色表达）',
    verdictEntries.length === 3
    && ['match', 'mismatch', 'not-run'].every((k) =>
      verdictEntries.some(([kk, v]) => kk === k && /[\u4e00-\u9fff]/.test(v)))
    && new Set(verdictEntries.map((e) => e[1])).size === 3,
    `抠出 ${verdictEntries.length} 档：${verdictEntries.map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

if (!skipAll) {
  section('【13】活体对账：真跑部分（RuntimeProbe CLI，需要 bash + JDK + .m2）');

  const rtScript = path.join(serverRoot, 'scripts', 'runtime-probe.sh');
  const rtFixture = path.join(here, 'fixtures', 'runtime-demo');
  const rtBroken = path.join(here, 'fixtures', 'runtime-broken');

  /** spawn 一次采集。返回解析后的 JSON；跑不起来返回 null（断言会因此变红，不会静默通过） */
  const runRt = (args: string[], timeoutMs = 240_000): any | null => {
    const res = spawnSync('bash', [rtScript.replace(/\\/g, '/'), ...args], {
      cwd: serverRoot, encoding: 'utf8', timeout: timeoutMs,
    });
    const lines = (res.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
    if (lines.length === 0) {
      console.log(`  [采集失败] ${(res.stdout ?? '').slice(-300)}${(res.stderr ?? '').slice(-300)}`);
      return null;
    }
    try {
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return null;
    }
  };

  const toWindows = (p: string) => p.replace(/\\/g, '/');

  // ── 13-0 引用核实：fixture 必须真的在 ────────────────────────
  // 不加这一条的代价实测过一次：fixture 建在了仓库根 .verify/ 而不是 arsenal-web/.verify/，
  // 于是「目录不存在 → 读不到 pom → 起不来」被 13-3 判成**通过** ——
  // 「故意起不来」和「根本没这个目录」长得一模一样，断言就成了摆设。
  // 所以真跑之前先把「素材真的存在」钉死。
  const rtDemoPom = path.join(rtFixture, 'pom.xml');
  const rtDemoMain = path.join(rtFixture, 'src', 'main', 'java', 'demo', 'DemoApplication.java');
  const rtBrokenPom = path.join(rtBroken, 'pom.xml');
  const rtBrokenMain = path.join(rtBroken, 'src', 'main', 'java', 'demo', 'BrokenApplication.java');
  check('13-0 引用核实：两个 fixture（好 / 故意编译错）的 pom.xml 与入口源码都真实存在',
    fs.existsSync(rtScript) && fs.existsSync(rtDemoPom) && fs.existsSync(rtDemoMain)
    && fs.existsSync(rtBrokenPom) && fs.existsSync(rtBrokenMain),
    `script=${fs.existsSync(rtScript)} demo=${fs.existsSync(rtDemoPom)}&${fs.existsSync(rtDemoMain)} broken=${fs.existsSync(rtBrokenPom)}&${fs.existsSync(rtBrokenMain)}`);

  // ── 13-1 fixture 真跑一次：三问都有两侧证据 ──────────────────
  const rt = runRt([toWindows(rtFixture), 'demo.DemoApplication', 'spring-boot', '60000']);
  check('13-1 fixture 真跑起来：executed + 端口有值 + 证据带日志行号 + health 200 且 body 含 UP',
    rt !== null && rt.status === 'executed'
    && typeof rt.port?.value === 'number' && rt.port.value > 0
    && rt.port?.evidence?.line > 0 && String(rt.port.evidence.text).includes('Tomcat started on port')
    && rt.health?.probed === true && rt.health.httpStatus === 200
    && String(rt.health.body).includes('UP'),
    rt === null ? '采集没跑起来（见上方 [采集失败]）'
      : `status=${rt.status} port=${rt.port?.value} line=${rt.port?.evidence?.line} health=${rt.health?.httpStatus}`);

  // ── 13-2 安全红线：跑完必须死干净 ────────────────────────────
  // 拿启动日志里那个**真实 PID** 去查，不是数 java 进程总数 ——
  // 数总数会被别的会话干扰（10-12/10-13 就有 3 个别的 java 挂在机器上），
  // 那种断言要么永远绿（等于没有），要么随机红（没人再信）。
  const logText = (rt?.log?.tail ?? []).map((l: any) => l.text).join('\n');
  const pidMatch = /with PID (\d+)/.exec(logText);
  const rtPid = pidMatch ? pidMatch[1] : null;
  let pidGone = false;
  if (rtPid) {
    const tl = spawnSync('tasklist', ['/FI', `PID eq ${rtPid}`], { encoding: 'utf8' });
    pidGone = !(tl.stdout ?? '').includes(rtPid);
  }
  check('13-2 安全红线：采完即杀 —— 启动日志里那个真 PID 已不存在，且 stoppedBy=signal（是我们杀的，不是它自己退的）',
    rtPid !== null && pidGone && rt?.process?.stoppedBy === 'signal',
    `pid=${rtPid} gone=${pidGone} stoppedBy=${rt?.process?.stoppedBy}`);

  // ── 13-3 起不来的工程：必须说「起不来」，不许说「健康/正常」 ──
  const rtBad = runRt([toWindows(rtBroken), 'demo.BrokenApplication', 'spring-boot', '30000']);
  const rtBadJson = JSON.stringify(rtBad ?? {});
  check('13-3 故意编译不过的 fixture → not-executed + reason 非空可读，且整份输出里不出现「健康 / 正常 / 没问题」',
    rtBad !== null && rtBad.status === 'not-executed'
    && typeof rtBad.reason === 'string' && rtBad.reason.trim().length >= 6
    && !rtBadJson.includes('健康') && !rtBadJson.includes('正常') && !rtBadJson.includes('没问题'),
    rtBad === null ? '采集没跑起来' : `status=${rtBad.status} reason=${String(rtBad.reason).slice(0, 60)}`);

  // ── 13-4 路径逃逸：拒绝且报错可读 ────────────────────────────
  const rtEsc = runRt([toWindows(rtFixture), 'demo.DemoApplication', 'spring-boot', '30000', '../..']);
  const runStep = (rtEsc?.steps ?? []).find((s: any) => s.name === 'run');
  check('13-4 路径逃逸入参 ../.. → run 这一步被拒（refused），进程一个都没起',
    rtEsc !== null && runStep?.status === 'refused' && rtEsc.status === 'not-executed',
    rtEsc === null ? '采集没跑起来' : `run.status=${runStep?.status} status=${rtEsc.status} workDir=${rtEsc.workDir}`);

  // ── 13-5 墙钟上限：到点没起来就是没起来，不许静默成功 ────────
  // 判据刻意全用**状态码**而不是中文子串：stdout 经过 bash→node 这一趟，
  // 中文在本机 GBK 控制台下会显示成乱码，拿中文去 includes 于环境相关 ——
  // 那种断言今天红明天绿，没人会再信它。stoppedBy='timeout' 就是「被超时杀掉」的精确说法。
  const rtTmo = runRt([toWindows(rtFixture), 'demo.DemoApplication', 'spring-boot', '1200']);
  check('13-5 墙钟 1.2s 内起不来 → not-executed 且 process 是 timeout/stoppedBy=timeout（超时不许被当成成功）',
    rtTmo !== null && rtTmo.status === 'not-executed'
    && rtTmo.process?.status === 'timeout'
    && rtTmo.process?.stoppedBy === 'timeout'
    && typeof rtTmo.reason === 'string' && rtTmo.reason.trim().length >= 6,
    rtTmo === null ? '采集没跑起来'
      : `status=${rtTmo.status} process=${rtTmo.process?.status}/${rtTmo.process?.stoppedBy} reasonLen=${String(rtTmo.reason ?? '').length}`);

  // ── 13-6 非 spring-boot 入口：明说不支持，不许说「跑过了」 ────
  const rtNode = runRt([toWindows(rtFixture), 'demo.DemoApplication', 'node-start', '30000']);
  check('13-6 runtime=node-start → not-executed + supported=false + reason 说清「不是跑过了」',
    rtNode !== null && rtNode.status === 'not-executed' && rtNode.supported === false
    && String(rtNode.reason).includes('spring-boot'),
    rtNode === null ? '采集没跑起来' : `status=${rtNode.status} supported=${rtNode.supported}`);

  // ── 13-7 确定性：同输入两次 → 对账结论逐字段相等（端口这种随机值除外）──
  const rt2 = runRt([toWindows(rtFixture), 'demo.DemoApplication', 'spring-boot', '60000']);
  const r1 = reconcileRuntime(factsWithEntry, [rt]);
  const r2 = reconcileRuntime(factsWithEntry, [rt2]);
  // 端口是 --server.port=0 的随机值，**它出现在entry 那条结论的措辞里**（「起来了，监听 64165」）。
  // 逐字段相等要比的是**结论稳不稳**，不是随机数一不一样 —— 所以先把两个端口替换掉再比。
  const norm = (r: any, ports: number[]) =>
    JSON.stringify(r.rows.map((x: any) => {
      let text = x.reason;
      for (const p of ports) text = String(text).split(String(p)).join('<PORT>');
      return { k: x.kind, q: x.question, v: x.verdict, r: text };
    }));
  const ports = [rt?.port?.value, rt2?.port?.value].filter((n: unknown) => typeof n === 'number');
  check('13-7 同输入采集两次 → 对账结论逐字段相等（唯一允许变的是那次采集的随机端口）',
    rt2 !== null && rt2.status === 'executed'
    && norm(r1, ports) === norm(r2, ports)
    && r1.counts.match === r2.counts.match
    && rt?.port?.value !== rt2?.port?.value,
    rt2 === null ? '第二次采集没跑起来'
      : `端口 ${rt?.port?.value} vs ${rt2?.port?.value}（应当不同）结论相等=${norm(r1, ports) === norm(r2, ports)}`);
}

// ── 收尾清理（finally 语义，2026-09-26 终检 P2-9）────────────────
// 本层经探针在 tmp/scan-check 下造的 fixture（many-repo 20001 个 0 字节文件、
// big/deep-repo、escape.zip/large.zip、link-repo 软链）与各笔回执 JSON 只在单次运行内有意义。
// 以前跑完不删，many-repo 的一万个 0 字节文件一直挂在 .verify/tmp/ 里。
// 挂 process.on('exit') 而不是在尾部顺序执行：正常收尾、check 抛异常、process.exit 提前退出都会清；
// rmSync 是同步调用，exit 回调里合法；recursive+force 保证目录不存在也不抛；
// rmSync 按 lstat 语义删除，link-repo 里的符号链接只删链接本身、不跟随到目标。
// 清理失败不影响验证结论。runner 侧既有惯例 CODEBUDDY_SAFE_DELETE_ENABLED=0 不受影响（本文件不走它）。
process.on('exit', () => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 残骸清理失败不改变验证结果 */
  }
});

console.log('');
if (skipAll) {
  // 整层未执行：记本层声明的项数为「跳过」，**不计通过也不计失败**，退出码由 finish 判为 2。
  skipLayer('scan', skipReason);
}
process.exit(finish('scan'));
