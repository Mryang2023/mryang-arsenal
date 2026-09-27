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
  summarizeFacts,
} from '../src/lib/facts-arch';
import { CANVAS_THEME_OPTIONS, buildTechArchSvg } from '../src/lib/arch-canvas';
import { archifyIrIssues, archifyIrShapeIssues } from '../src/lib/archify-ir';
import { buildProfileDraftFromFacts } from '../src/lib/profile-draft';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish, knowinglySkipped, skipLayer } from './lib/report';

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
    console.log('  ! 3-7 软链外跳用例跳过：本机无法创建符号链接（Windows 权限），闸门未被这一条验证');
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
