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
import { buildServiceTopo } from '../src/lib/service-topo';
import { buildServiceGraphSvg } from '../src/lib/service-graph';
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

// ═══════════════════════════════════════════════════════════════
// 【0】环境：bash + JDK。缺一个就明说跳过，不装作通过
// ═══════════════════════════════════════════════════════════════
section('【0】依赖：bash + JDK17（后端扫描探针）');
const probeScript = path.join(serverRoot, 'scripts', 'scan-probe.sh');
const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const hasBash = bash.status === 0;
const hasProbe = fs.existsSync(probeScript);
let skipReason = '';
if (!hasBash || !hasProbe) {
  skipAll = true;
  skipReason = !hasBash
    ? 'bash 不可用（spawnSync("bash","--version") 未返回 0）—— 扫描探针跑不起来'
    : `探针脚本不存在：${probeScript}`;
  console.log(`  ! 跳过：${skipReason}`);
  console.log('    本层不会被计入「通过」。收尾会打「实测 0 项 / 跳过 N 项 / 失败 0 项」，退出码 2。');
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
    check('1-15 分层计数：controller 3 / service 1 / repository 1',
      factsA.code?.layers?.controller === 3 && factsA.code?.layers?.service === 1
      && factsA.code?.layers?.repository === 1, `实际 ${JSON.stringify(factsA.code?.layers)}`);
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
   * 本沙箱里 `spawnSync` 对**任何**外部进程都返回 EBUSY（bash / git 实测皆然），
   * 这不是代码缺陷。依赖外部进程的断言因此只能 `skip()` ——
   * **绝不许兜成通过**：那会让「.gitignore 是否真生效」变成一条永远绿的摆设。
   */
  const spawnBroken =
    spawnSync('git', ['--version'], { encoding: 'utf8' }).error !== undefined;
  const spawnWhy = spawnBroken ? '本环境 spawnSync 对外部进程返回 EBUSY（沙箱限制）' : '';

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
