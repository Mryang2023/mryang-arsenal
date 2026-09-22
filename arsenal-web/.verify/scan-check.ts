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

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const serverRoot = path.resolve(webRoot, '..', 'arsenal-server');
const tmpDir = path.join(here, 'tmp', 'scan-check');
const fixture = path.join(here, 'fixtures', 'demo-repo');

let pass = 0;
let fail = 0;
let skipAll = false;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
  }
}

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
if (!hasBash || !hasProbe) {
  skipAll = true;
  console.log('  ! 跳过：缺少 bash 或 scan-probe.sh —— 本层未跑，verify 的绿不含扫描断言');
}

type Receipt = { action: string; kind: string; ok: boolean; code?: string; message?: string; facts?: any };

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

    check('1-9 deploy.k8s[0].replicas === 3', factsA.deploy?.k8s?.[0]?.replicas === 3,
      `实际 ${JSON.stringify(factsA.deploy?.k8s?.[0])}`);
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
  const r3 = runProbe('attack', [
    `zip:${escapeZip}`,
    `zip:${largeZip}`,
    'git:file:///c/Windows',
    'git:ssh://git@github.com/foo/bar.git',
    'git:git://github.com/foo/bar.git',
    'facts:../arsenal-web/不存在的目录',
  ]);
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
}

// ═══════════════════════════════════════════════════════════════
console.log('');
if (skipAll) {
  console.log('verify:scan —— 跳过（缺 bash / 探针脚本）。0 项通过、0 项失败。');
  process.exit(0);
}
console.log(`verify:scan —— ${pass} 项通过 / ${fail} 项失败`);
process.exit(fail > 0 ? 1 : 0);
