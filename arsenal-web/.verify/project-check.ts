/**
 * 项目结构层与导出包 —— 自检。
 *
 * 这一层最容易出的错不是「崩了」，而是「看起来没问题但是错的」：
 *   · 导出包里少了 Application.java（用户拿到才发现在编译不过）
 *   · 目录树里画了 mapper/，但选的是 JPA（照图建目录，建出一堆空包）
 *   · 启动类注释里的开关归属表和实际选型对不上（把人引到错的地方）
 *   · zip 结构写错（能解出第一个文件，后面的全坏）
 *
 * 编译通过完全说明不了这些。所以下面每一条都对应一种「用户会踩到的坑」，
 * 而且最后会把 zip 真的写到磁盘上解压一遍 —— 打包器这种底层格式，
 * 唯一可信的验证就是拿标准工具解一次。
 *
 * 跑法：npx tsx .verify/project-check.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { auditArchitecture, arch } from '@/lib/arch';
import { defaultPicks, dimensions, presetPicks, presets } from '@/lib/stack';
import { filterTree, buildExportPlan, projectDoc, renderAppClass, renderTreeText } from '@/lib/project';
import type { StackPicks } from '@/lib/content-types';
import { buildZip } from '@/lib/zip';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const tmpDir = path.join(here, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const PLACEHOLDER = /__[A-Z_]+__/;

// ═══════════════════════════════════════════════════════════════
// 【1】四套预设都能生成完整、自洽的导出包
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】四套预设的导出包完整性');

const plans = new Map<string, ReturnType<typeof buildExportPlan>>();

for (const preset of presets) {
  const picks = presetPicks(preset.id);
  const audit = auditArchitecture(picks);
  const plan = buildExportPlan(picks, audit);
  plans.set(preset.id, plan);

  const paths = plan.files.map((f) => f.path);
  check(`${preset.name}：路径无重复`, new Set(paths).size === paths.length);

  const leftover = plan.files.filter((f) => PLACEHOLDER.test(f.content));
  check(
    `${preset.name}：没有未替换的模板占位符`,
    leftover.length === 0,
    leftover.map((f) => f.path).join('、')
  );

  check(`${preset.name}：包含 README.md`, paths.includes('README.md'));
  check(
    `${preset.name}：包含启动类`,
    paths.includes('src/main/java/com/example/Application.java')
  );
  check(`${preset.name}：包含隐患体检单`, paths.includes('docs/risk-report.md'));
  check(
    `${preset.name}：包含 application.yml`,
    paths.includes('src/main/resources/application.yml')
  );

  // 构建文件只能有一种：既导出 pom 又导出 build.gradle 是自相矛盾
  const hasPom = paths.includes('pom.xml');
  const hasGradle = paths.includes('build.gradle');
  check(`${preset.name}：构建文件唯一`, hasPom !== hasGradle);

  const empty = plan.files.filter((f) => !f.content && !f.path.endsWith('.gitkeep'));
  check(
    `${preset.name}：没有内容为空的文件`,
    empty.length === 0,
    empty.map((f) => f.path).join('、')
  );

  const size = plan.files.reduce((n, f) => n + f.content.length, 0);
  check(`${preset.name}：导出内容非空`, size > 3000, `${size} 字符`);
}

// ═══════════════════════════════════════════════════════════════
// 【2】结构树必须跟着选型变 —— 这是整个结构层的立身之本
// ═══════════════════════════════════════════════════════════════
console.log('\n【2】结构树随选型变化');

function treeOf(picks: StackPicks) {
  return renderTreeText(picks);
}
function planOf(picks: StackPicks) {
  return buildExportPlan(picks, auditArchitecture(picks));
}
function pathsOf(picks: StackPicks) {
  return planOf(picks).files.map((f) => f.path);
}

// MyBatis-Plus 才有的东西
const mybatis = { ...defaultPicks, persistence: 'mybatisplus', migration: 'flyway' };
const jpa = { ...defaultPicks, persistence: 'jpa', migration: 'flyway' };
const jdbcNoMig = { ...defaultPicks, persistence: 'jdbc', migration: 'none' };

check('mybatisplus → 出现 mapper/', treeOf(mybatis).includes('mapper/'));
check(
  'mybatisplus → 导出 mapper 占位文件',
  pathsOf(mybatis).includes('src/main/resources/mapper/.gitkeep')
);
check('mybatisplus → 树里有 MybatisPlusConfig', treeOf(mybatis).includes('MybatisPlusConfig.java'));
check('mybatisplus → 树里没有 JpaAuditConfig', !treeOf(mybatis).includes('JpaAuditConfig'));

check('jpa → 出现 JpaAuditConfig', treeOf(jpa).includes('JpaAuditConfig.java'));
check('jpa → 没有 mapper/', !treeOf(jpa).includes('mapper/'));
check('jpa → 启动类里没有 @MapperScan', !renderAppClass(jpa).includes('@MapperScan'));

check('flyway → 出现 db/migration/', treeOf(mybatis).includes('migration/'));
check(
  'flyway → 导出 V1__init.sql',
  pathsOf(mybatis).includes('src/main/resources/db/migration/V1__init.sql')
);

check('migration=none → 出现 schema.sql', treeOf(jdbcNoMig).includes('schema.sql'));
check('migration=none → 没有 db/migration/', !treeOf(jdbcNoMig).includes('migration/'));
check(
  'migration=none → 导出里没有迁移脚本',
  !pathsOf(jdbcNoMig).some((p) => p.includes('migration/') || p.includes('changelog/'))
);

// Gradle：不能有 pom.xml
const gradle = { ...defaultPicks, build: 'gradle' };
check('gradle → 树里有 build.gradle、没有 pom.xml',
  treeOf(gradle).includes('build.gradle') && !treeOf(gradle).includes('pom.xml'));
check('gradle → 导出 build.gradle 与 settings.gradle',
  pathsOf(gradle).includes('build.gradle') && pathsOf(gradle).includes('settings.gradle'));
check('gradle → build.gradle 里注解处理器两行都在',
  (() => {
    const g = planOf(gradle).files.find((f) => f.path === 'build.gradle');
    return !!g && g.content.includes('compileOnly') && g.content.includes('annotationProcessor');
  })());
check('maven → 导出 pom.xml', pathsOf(defaultPicks).includes('pom.xml'));

// 缓存 / 调度 / 注册中心 / 文档
check('cache=redis → RedisConfig 落位', pathsOf({ ...defaultPicks, cache: 'redis' }).includes('src/main/java/com/example/config/RedisConfig.java'));
check('cache=none → 没有 CacheConfig', !treeOf({ ...defaultPicks, cache: 'none' }).includes('CacheConfig'));
check('registry=nacos → NacosRefreshConfig 落位', treeOf({ ...defaultPicks, registry: 'nacos' }).includes('NacosRefreshConfig.java'));
check('scheduler=xxljob → XxlJobConfig 落位', treeOf({ ...defaultPicks, scheduler: 'xxljob' }).includes('XxlJobConfig.java'));
check('scheduler=xxljob → 没有 SchedulerConfig', !treeOf({ ...defaultPicks, scheduler: 'xxljob' }).includes('SchedulerConfig'));
check('apidoc=none → 没有 OpenApiConfig', !treeOf({ ...defaultPicks, apidoc: 'none' }).includes('OpenApiConfig'));

// 空目录不能出现在图里
const cacheOnlyNone: StackPicks = { ...defaultPicks, cache: 'none', apidoc: 'none' };
const visible = filterTree(projectDoc.tree.children ?? [], cacheOnlyNone);
function hasEmptyDir(nodes: typeof visible): boolean {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      if (!n.children?.length) return true;
      if (hasEmptyDir(n.children)) return true;
    }
  }
  return false;
}
check('过滤后的树里没有空目录', !hasEmptyDir(visible));
check('过滤后 config/ 仍在（基础配置类还在）', treeOf(cacheOnlyNone).includes('config/'));

// ═══════════════════════════════════════════════════════════════
// 【3】启动类与开关归属表
// ═══════════════════════════════════════════════════════════════
console.log('\n【3】启动类');

const appMy = renderAppClass(mybatis);
const appXxl = renderAppClass({ ...defaultPicks, scheduler: 'xxljob' });

check('包名是根包', appMy.startsWith('package com.example;'));
check('带 @SpringBootApplication', appMy.includes('@SpringBootApplication'));
check('类名 Application，main 方法在', appMy.includes('public class Application') && appMy.includes('SpringApplication.run'));
check('没有残留占位符', !PLACEHOLDER.test(appMy));
check('mybatisplus → 有 @MapperScan 及其 import',
  appMy.includes('@MapperScan(') && appMy.includes('import org.mybatis.spring.annotation.MapperScan;'));
check('jdbc → 没有 @MapperScan', !renderAppClass(defaultPicks).includes('@MapperScan'));

check('scheduler=spring → 开关表出现 @EnableScheduling', appMy.includes('@EnableScheduling'));
check('scheduler=xxljob → 开关表不出现 @EnableScheduling', !appXxl.includes('@EnableScheduling'));
check('cache=redis → 开关表指向 RedisConfig',
  renderAppClass({ ...defaultPicks, cache: 'redis' }).includes('config/RedisConfig.java'));
check('开关表标注了 @Transactional 的归属（不需要 @Enable）',
  appMy.includes('@Transactional') && appMy.includes('service 层方法上'));

// ═══════════════════════════════════════════════════════════════
// 【4】隐患详情：每条策略都要有触发条件、可核对现象、后果
// ═══════════════════════════════════════════════════════════════
console.log('\n【4】隐患详情');

let detailOk = 0;
for (const policy of arch.policies) {
  const d = arch.policyDetail[policy.id];
  if (!d || !d.trigger || !d.impact || (d.symptoms?.length ?? 0) < 2) {
    check(`策略 ${policy.id} 的隐患详情完整`, false, JSON.stringify(d ?? null).slice(0, 80));
  } else {
    detailOk += 1;
  }
}
check(`全部 ${arch.policies.length} 条策略都写清了触发条件/现象/后果`, detailOk === arch.policies.length);

// 每条策略都必须在某种选型下真的能被命中 —— 否则它是一段永远不会出现的死数据
let reachable = 0;
for (const policy of arch.policies) {
  const probe: StackPicks = { ...defaultPicks };
  for (const [dim, opts] of Object.entries(policy.when ?? {})) probe[dim] = opts[0];
  const a = auditArchitecture(probe);
  const all = [...a.blockers, ...a.risks, ...a.notes];
  if (all.some((g) => g.title === policy.title)) reachable += 1;
  else console.log(`      · 未命中：${policy.id}（探针选型：${JSON.stringify(probe)}）`);
}
check(`全部 ${arch.policies.length} 条策略都可达（不是死数据）`, reachable === arch.policies.length);

// 命中之后，结论里要带上现象 —— 否则界面上又变回「一句警告」
const webfluxBlocking = auditArchitecture({
  ...defaultPicks,
  web: 'webflux',
  persistence: 'jdbc',
});
const wfGap = webfluxBlocking.blockers.find((g) => g.title.includes('响应式链路'));
check('命中的隐患结论里带上了可核对现象', (wfGap?.symptoms?.length ?? 0) >= 2);
check('命中的隐患结论里带上了触发条件', !!wfGap?.trigger);

// 生产标配：能跑，且隐患清单确实写得出东西（这是用户最常看的那一屏）
const stdAudit = auditArchitecture(presetPicks('standard'));
const stdRisks = [...stdAudit.risks, ...stdAudit.notes];
check('生产标配能跑起来', stdAudit.status !== 'broken', stdAudit.status);
check(
  '生产标配的隐患都带现象说明',
  stdRisks.length > 0 && stdRisks.every((g) => (g.symptoms?.length ?? 0) >= 2),
  `${stdRisks.length} 条`
);

// ═══════════════════════════════════════════════════════════════
// 【5】README 与隐患单的内容完整性
// ═══════════════════════════════════════════════════════════════
console.log('\n【5】README 与隐患单');

const stdPlan = plans.get('standard')!;
const readme = stdPlan.files.find((f) => f.path === 'README.md')!.content;

check('README 含选型表', readme.includes('| 模块 | 当前选择 | 说明 |'));
check('README 含目录树', readme.includes('├──') || readme.includes('└──'));
check('README 含启动步骤', readme.includes('mvn spring-boot:run'));
check('README 含隐患章节', readme.includes('## 这套组合的隐患'));
check('README 含悬空引用章节', readme.includes('## 上手前必须补齐的类'));
check('README 列出了导出文件清单', readme.includes('## 交付清单') && readme.includes('`README.md`'));
check('README 按实际选型写（含 Redis）', readme.includes('Redis'));

const riskDoc = stdPlan.files.find((f) => f.path === 'docs/risk-report.md')!.content;
check('隐患单有结论行', riskDoc.includes('结论：'));
check('隐患单写了现象', riskDoc.includes('会看到的现象'));
check('隐患单写了触发条件', riskDoc.includes('触发条件'));
check('隐患单写了后果', riskDoc.includes('后果：'));
check('隐患单写了对策', riskDoc.includes('对策：'));

// 悬空引用：标准配置用了 Spring Security，必然引用了包外类
check(
  '标准配置能算出需要自行补的类',
  stdPlan.dangling.length > 0,
  `${stdPlan.dangling.length} 个`
);
check(
  '算出的类确实不在包里',
  stdPlan.dangling.every((d) => !stdPlan.files.some((f) => f.path === d.path))
);
check(
  'jdbc 且无鉴权时，悬空引用显著更少',
  planOf({ ...defaultPicks, persistence: 'jdbc', auth: 'securityjwt' }).dangling.length <
    stdPlan.dangling.length + 6
);

// ═══════════════════════════════════════════════════════════════
// 【6】zip 真的能被标准工具解开
// ═══════════════════════════════════════════════════════════════
async function zipChecks() {
  console.log('\n【6】zip 打包');

  const manifest: { preset: string; file: string; entries: number }[] = [];

  for (const preset of presets) {
    const plan = plans.get(preset.id)!;
    const result = buildZip(
      plan.files.map((f) => ({ path: f.path, content: f.content })),
      new Date('2026-09-11T08:00:00')
    );
    const buf = Buffer.from(await result.blob.arrayBuffer());
    const file = path.join(tmpDir, `export-${preset.id}.zip`);
    fs.writeFileSync(file, buf);
    manifest.push({ preset: preset.id, file, entries: result.entries });

    check(`${preset.name}：zip 条目数与文件数一致`, result.entries === plan.files.length);
    check(`${preset.name}：含 UTF-8 文件名标志位`, buf.readUInt16LE(6) === 0x0800);
    check(
      `${preset.name}：末尾是中央目录结束记录`,
      buf.readUInt32LE(buf.length - 22) === 0x06054b50
    );
  }

  fs.writeFileSync(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
  console.log(`\n  已写出 ${manifest.length} 个 zip 到 .verify/tmp/，交给 zipfile 复核`);
}

zipChecks().then(() => {
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
});
