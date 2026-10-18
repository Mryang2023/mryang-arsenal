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
import { createHash } from 'node:crypto';
import { projectIdOf, sha256hex } from '../scripts/lib/autopsy-snapshot-shape.mjs';
import { auditArchitecture, arch } from '@/lib/arch';
import { defaultPicks, dimensions, presetPicks, presets } from '@/lib/stack';
import { buildExportPlan, projectDoc, renderAppClass, renderTreeText, treeFromFiles, type TreeNode } from '@/lib/project';
import { buildArchDiagram, archDiagramD2, archDiagramMermaid } from '@/lib/arch-diagram';
import type { StackPicks } from '@/lib/content-types';
import { buildZip } from '@/lib/zip';
import { liveStats, orderedCategories, rules } from '@/lib/rules';
import { allRelatedRules, cookbookStats, recipeLocations, recipesByRule } from '@/lib/cookbook';
import { lintFeatureFiles } from '@/lib/cookbook-lint';
import {
  APP_ENDPOINTS,
  APP_ROUTES,
  ARCH_VIEWS,
  ARCH_VIEW_IDS,
  BUSINESS_DOMAINS,
  BUSINESS_OUTLETS,
  DATA_ASSETS,
  ENGINE_LAYERS,
  MUST_LIMIT,
  PROFILE_ORDER,
  PROFILE_SUMMARIES,
  PROJECT_ROADMAP,
  SEVERITY_ROWS,
  VERIFY_CHAIN,
  VERIFY_TOTAL,
  profileIssues,
} from '@/lib/arch-views';
import { buildTechArch, buildTechArchSvg, emptyEdits } from '@/lib/arch-canvas';
import { ARCH_GLYPHS } from '@/lib/arch-glyphs';
import { svgMotionStyle } from '@/lib/arch-motion';
import { TECH_ICONS } from '@/lib/tech-icons';
import { ICON_CATEGORIES, iconAssets } from '@/lib/icon-assets';
import { isNavActive, groupShouldOpen } from '@/lib/nav-active';
import { STACK_NAV } from '@/app/stack/wizard';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish } from './lib/report';

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
function readmeOf(picks: StackPicks) {
  return planOf(picks).files.find((f) => f.path === 'README.md')!.content;
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

// 09-28 十反馈第二轮：schema.sql 真实生成了（无迁移工具时它是唯一的建表脚本），
// 口径从「不画不会生成的东西」反转为「画了就必须真生成」。
check('migration=none → 树里画 schema.sql 且包里真有（开箱即跑的建表脚本）',
  treeOf(jdbcNoMig).includes('schema.sql') &&
    pathsOf(jdbcNoMig).includes('src/main/resources/db/schema.sql'));
check('migration=none → 树里有 schema.sql、没有 db/migration/',
  treeOf(jdbcNoMig).includes('schema.sql') && !treeOf(jdbcNoMig).includes('migration/'));
check(
  'migration=none → 导出里没有迁移目录',
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

// 空目录不能出现在树里。树已改为**从导出清单合成**（09-28 十反馈「货不对版」）：
// 目录只在有文件落进来时才存在，按构造不可能为空 —— 这条断言留作防御。
const cacheOnlyNone: StackPicks = { ...defaultPicks, cache: 'none', apidoc: 'none' };
const visible = treeFromFiles(
  [{ path: 'docs/risk-report.md' }, { path: 'deploy/Dockerfile' }, { path: 'pom.xml' }],
  'x/'
).children ?? [];
function hasEmptyDir(nodes: TreeNode[]): boolean {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      if (!n.children?.length) return true;
      if (hasEmptyDir(n.children)) return true;
    }
  }
  return false;
}
check('合成树里没有空目录', !hasEmptyDir(visible));
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
// 2026-09-29 E2E 实测：@MapperScan("com.example.**.repository") 宽模式会把 auth/模块体系的
// 普通仓储接口误注册成 MyBatis Mapper，启动即 Bean 二义性失败 —— 已从启动类移除，
// 所有 Mapper 接口自带 @Mapper，交给 MyBatis-Plus 自动扫描。断言反转为「不许回来」。
check('mybatisplus → 启动类不再携带 @MapperScan（自动扫描 @Mapper 取代）',
  !appMy.includes('@MapperScan('));
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
check('README 含开箱即跑章节（十反馈第二轮口径）', readme.includes('## 开箱即跑'));
check('README 不再写「只含结构与配置」的旧口径', !readme.includes('不含业务代码'));
check('README 列出了导出文件清单', readme.includes('## 交付清单') && readme.includes('`README.md`'));
check('README 按实际选型写（含 Redis）', readme.includes('Redis'));

const riskDoc = stdPlan.files.find((f) => f.path === 'docs/risk-report.md')!.content;
check('隐患单有结论行', riskDoc.includes('结论：'));
check('隐患单写了现象', riskDoc.includes('会看到的现象'));
check('隐患单写了触发条件', riskDoc.includes('触发条件'));
check('隐患单写了后果', riskDoc.includes('后果：'));
check('隐患单写了对策', riskDoc.includes('对策：'));

// 悬空引用：09-28 十反馈第二轮起导出包含真实脚手架代码（SCAFFOLD），
// 配置类引用的类全部在包内 —— 悬空引用必须归零，归零才是「开箱即跑」的证明。
// 若这里非零，说明 SCAFFOLD / configClasses 的 when 或代码路径出了分叉。
check('悬空引用归零（脚手架补齐了全部被引用的类）', stdPlan.dangling.length === 0,
  `${stdPlan.dangling.length} 个` +
  (stdPlan.dangling.length ? ' → ' + stdPlan.dangling.map((d) => d.fqn).join(', ') : ''));
check(
  '算出的悬空类确实不在包里（守卫逻辑本身仍然有效）',
  stdPlan.dangling.every((d) => !stdPlan.files.some((f) => f.path === d.path))
);
// 脚手架锚点：SCAFFOLD 数据若在构建/同步链路里静默丢失（假绿典型形态，
// projectDoc.scaffold 变 undefined 后循环空转、其余断言照样绿），这些锚点会缺失。
const minimalPlan = plans.get('minimal')!;
const minPaths = new Set(minimalPlan.files.map((f) => f.path));
for (const anchor of [
  'src/main/java/com/example/common/ApiResponse.java',
  'src/main/java/com/example/common/PageResult.java',
  'src/main/java/com/example/common/ErrorCode.java',
  'src/main/java/com/example/common/exception/BizException.java',
  'src/main/java/com/example/common/web/GlobalExceptionHandler.java',
  'src/main/java/com/example/config/WebMvcConfig.java',
  'src/main/java/com/example/config/JacksonConfig.java',
  'src/main/java/com/example/config/AsyncConfig.java',
  'src/main/java/com/example/config/RetryConfig.java',
  'src/main/java/com/example/interceptor/TraceIdInterceptor.java',
  'src/main/java/com/example/filter/RequestLogFilter.java',
  'src/main/java/com/example/security/JwtAuthenticationFilter.java',
  'src/main/java/com/example/security/CurrentUserHolder.java',
  'src/main/java/com/example/interceptor/AuthInterceptor.java',
  'src/main/java/com/example/user/controller/UserController.java',
  'src/main/java/com/example/user/service/UserService.java',
  'src/main/java/com/example/user/domain/User.java',
  'src/main/java/com/example/user/repository/UserDao.java',
  'src/main/java/com/example/user/exception/UserNotFoundException.java',
  'src/main/resources/logback-spring.xml',
]) {
  check(`minimal 脚手架锚点在包内 ${anchor.split('/').slice(-2).join('/')}`, minPaths.has(anchor));
}
// minimal（jdbc + flyway）不该有 mybatisplus / 无迁移工具的文件
check('minimal（jdbc）不含 UserMapper.xml', !minPaths.has('src/main/resources/mapper/UserMapper.xml'));
check('minimal（flyway）不含 schema.sql', !minPaths.has('src/main/resources/db/schema.sql'));
const v1File = minimalPlan.files.find((f) => f.path === 'src/main/resources/db/migration/V1__init.sql');
check('V1__init.sql 含 user 表（user 六件套才能跑）',
  !!v1File && v1File.content.includes('CREATE TABLE `user`'));
const minPom = minimalPlan.files.find((f) => f.path === 'pom.xml');
check('pom 含 jjwt（JWT 过滤器的真实依赖）', !!minPom && minPom.content.includes('jjwt-api'));
check('pom 含 starter-validation（DTO 校验注解的依赖）',
  !!minPom && minPom.content.includes('spring-boot-starter-validation'));

// ═══════════════════════════════════════════════════════════════
// 【6】zip 真的能被标准工具解开
// ═══════════════════════════════════════════════════════════════
async function zipChecks() {
  console.log('\n【7】zip 打包');

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

// ═══════════════════════════════════════════════════════════════
// 【6】架构图与技术说明
//
// 这张图是自己拼 SVG 拼出来的，没有引擎兜底 —— 所以必须用断言把
// 「画出来是什么样」钉住：槽位一个不少、坐标没有 NaN、中文没被截断、
// 每个状态都有图例解释。否则改一次版式就可能悄悄画歪。
// ═══════════════════════════════════════════════════════════════
console.log('\n【6】架构图与技术说明');

for (const preset of presets) {
  const picks = preset.picks as StackPicks;
  const audit = auditArchitecture(picks);
  const plan = planOf(picks);
  const svgFile = plan.files.find((f) => f.path === 'architecture.svg');
  const docFile = plan.files.find((f) => f.path === 'ARCHITECTURE.md');

  check(`${preset.name}：导出包含 architecture.svg`, !!svgFile);
  check(`${preset.name}：导出包含 ARCHITECTURE.md`, !!docFile);
  if (!svgFile || !docFile) continue;

  const svg = svgFile.content;
  const doc = docFile.content;

  // ① 合法性与可解析性：坐标里出现 NaN 的图，浏览器会整块不画
  check(`${preset.name}：SVG 无 NaN 坐标`, !/NaN|undefined|Infinity/.test(svg));
  check(
    `${preset.name}：SVG 标签闭合`,
    svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>')
  );
  check(`${preset.name}：SVG 带 viewBox`, /viewBox="0 0 \d+ \d+"/.test(svg));

  // ② 槽位齐全：17 个槽位一个都不能漏，漏了图就不再是这张架构图
  const slots = Object.keys(arch.nodes);
  const diagram = buildArchDiagram({ picks, audit, title: 'x' });
  const drawn = diagram.model.lanes.flatMap((l) => l.slots.map((s) => s.dimId));
  check(
    `${preset.name}：17 个槽位全部上图`,
    drawn.length === slots.length && slots.every((id) => drawn.includes(id)),
    `${drawn.length}/${slots.length}`
  );
  check(`${preset.name}：${arch.lanes.length} 条泳道齐全`, diagram.model.lanes.length === arch.lanes.length);

  // ③ 中文必须真的进了 SVG。早期用错转义时中文会整片消失，而 SVG 依然「合法」。
  const cjkCount = (svg.match(/[\u4e00-\u9fff]/g) ?? []).length;
  check(`${preset.name}：图上保留了中文标签`, cjkCount >= 80, `${cjkCount} 个汉字`);
  check(`${preset.name}：所有泳道名都在图上`, arch.lanes.every((l) => svg.includes(l.name)));

  // ④ 状态必须可区分：缺必需 / 缺建议 / 已选 / 未选，四种画法都要在图例里出现
  for (const label of ['已选', '缺必需', '缺建议', '未选']) {
    check(`${preset.name}：图例含「${label}」`, svg.includes(`>${label}<`));
  }

  // ⑤ 必须有一眼可辨的「跑不起来」信号：缺必需模块时图上要有红
  if (audit.blockers.length > 0) {
    check(`${preset.name}：有阻塞项时图上出现告警色`, svg.includes('#C0392B'));
  }

  // ⑥ 技术说明与图同源：图的结论必须和 audit 的结论一致
  check(`${preset.name}：说明文档含结论行`, doc.includes('结论：**'));
  check(
    `${preset.name}：说明文档结论与校验一致`,
    doc.includes(audit.status === 'broken' ? '跑不起来' : audit.status === 'incomplete' ? '能跑，但零件不全' : '可以跑起来')
  );
  check(`${preset.name}：说明文档含请求链路`, doc.includes('## 二、请求链路'));
  check(`${preset.name}：说明文档含能力供需`, doc.includes('## 三、能力供需'));
  check(`${preset.name}：说明文档解释了怎么读图`, doc.includes('## 五、怎么读那张图'));
  check(`${preset.name}：README 已插入架构图小节`, readmeOf(picks).includes('## 架构图'));

  // ⑦ README 里的相对链接必须真能命中包里的文件，否则点开是 404
  const md = readmeOf(picks);
  check(`${preset.name}：README 引用了 architecture.svg`, md.includes('(architecture.svg)'));
  check(`${preset.name}：README 引用了 ARCHITECTURE.md`, md.includes('(ARCHITECTURE.md)'));
}

// DSL 源码：拼字符串不要钱，但要保证拼出来的是能用的语法
{
  const picks = presetPicks('standard');
  const audit = auditArchitecture(picks);
  const d = buildArchDiagram({ picks, audit, title: 'x' });
  const d2 = archDiagramD2(d.model);
  const mmd = archDiagramMermaid(d.model);
  check('D2 源码含全部泳道', arch.lanes.every((l) => d2.includes(`${l.id}: ${l.name} {`)));
  check('D2 源码含数据层流水线', d2.includes('data.persistence -> data.database'));
  check('Mermaid 源码含 subgraph', (mmd.match(/subgraph /g) ?? []).length === arch.lanes.length);
  check('Mermaid 源码含流水线箭头', mmd.includes('-->'));
}

// ═══════════════════════════════════════════════════════════════
// 【9】六大架构视图数据层 —— 图上的每个数字必须能追溯到真实数据
// ═══════════════════════════════════════════════════════════════
console.log('\n【9】六大架构视图数据层');
{
  // ① 六视图齐且 id 唯一，技术架构必须在列
  const ids = ARCH_VIEWS.map((v) => v.id);
  check(
    '六大视图：id 齐且唯一',
    ids.length === 6 && new Set(ids).size === 6 && ids.includes('tech')
  );
  check(
    '六大视图：口径字段齐（定义 / 关注 / 问题 / 产出）',
    ARCH_VIEWS.every(
      (v) =>
        v.definition.length >= 20 &&
        v.focus.length >= 3 &&
        v.question.length >= 10 &&
        v.outputs.length >= 2
    )
  );

  // ② 业务视图的能力域度量是算出来的，不是写死的字符串
  check(
    '业务视图：规范字典度量引用 liveStats',
    BUSINESS_DOMAINS[0].metric.includes(String(liveStats.total)) &&
      BUSINESS_DOMAINS[0].metric.includes(String(orderedCategories.length))
  );
  check(
    '业务视图：蓝图度量引用 cookbookStats',
    BUSINESS_DOMAINS[1].metric.includes(String(cookbookStats.features))
  );
  check(
    '业务视图：选型度量引用维度数',
    BUSINESS_DOMAINS[2].metric.includes(String(dimensions.length))
  );
  check('业务视图：三种出口齐', BUSINESS_OUTLETS.length === 3);

  // ③ 数据视图：资产路径真实存在（仓库里找得到目录）
  for (const dir of ['arsenal-rules', 'arsenal-cookbook', 'arsenal-stacks']) {
    check(
      `数据视图：${dir}/ 事实源目录存在`,
      fs.existsSync(path.resolve(here, '../..', dir))
    );
  }

  // ④ 应用视图：路由含 /autopsy（2026-10-17 架构图谱合并棒3：/arch 退役为
  //    重定向页，路由行的主角换成项目侦察 —— 六视图与画布都并进了它），
  //    接口全部带方法前缀
  check(
    '应用视图：路由含 /autopsy 且路径唯一',
    APP_ROUTES.some((r) => r.path === '/autopsy') &&
      new Set(APP_ROUTES.map((r) => r.path)).size === APP_ROUTES.length
  );
  check(
    '应用视图：接口声明带 HTTP 方法',
    APP_ENDPOINTS.every((g) => g.items.every((it) => /^(GET|POST) /.test(it)))
  );

  // ⑤ 产品视图：严重度计数之和 = 规则总数；引擎 L1 必须是已落地层
  check(
    '产品视图：严重度计数与规则总数一致',
    SEVERITY_ROWS.reduce((n, s) => n + s.count, 0) === liveStats.total
  );
  check(
    '产品视图：引擎 L1 已落地且度量引用可检出数',
    ENGINE_LAYERS[0].status === 'done' &&
      ENGINE_LAYERS[0].metric.includes(String(liveStats.regexCapable))
  );
  check(
    '产品视图：MUST+NEVER 之和不超过硬上限',
    SEVERITY_ROWS.filter((s) => s.name === 'MUST' || s.name === 'NEVER').reduce((n, s) => n + s.count, 0) <=
      MUST_LIMIT
  );

  // ⑥ 项目视图：验证链**形状**检查 —— 分项之和 = verifyTotal。
  //
  // ⚠️ 这是一句**恒等式**：`VERIFY_TOTAL` 的定义就是 `VERIFY_CHAIN` 的 reduce
  // （见 `src/lib/arch-views.ts:213-216`），两边同时从同一份档案派生，永远相等。
  // 它只说明「档案里链与总数自洽」，**不说明任何一层真的跑了那么多项**。
  //
  // 原先这句后面还挂着 `&& VERIFY_TOTAL === 662` —— 那个手写的 662 才是唯一
  // 真正起作用的约束，而它是第五份手抄件（另外四份在档案 / README×2 / 本文件）。
  // 手抄件的问题是：层内加了 3 项断言而数字没动，整套 verify 照样全绿
  // （引擎层从 14 涨到 17 就是这么漏掉的）。
  //
  // 现在那个手写数字**删掉了**，改由链尾的 `verify:meta`（`.verify/meta-check.ts`）
  // 读各层自己写出的 `layer-<key>.json`，逐层比「声明 X / 实测 Y」，不一致就红。
  // 为什么守门必须放链尾：本层跑在九层的**中间**，执行时 engine/parity/archify/scan
  // 还没开始，`layer-<key>.json` 根本不存在 —— 放这里只能读到半份或上一轮的陈旧文件。
  check(
    '项目视图：验证链分项之和 = 总数（恒等式，形状检查；实测项数归 verify:meta）',
    VERIFY_CHAIN.reduce((n, v) => n + v.count, 0) === VERIFY_TOTAL
  );
  check('项目视图：里程碑含 MCP 适配层', PROJECT_ROADMAP.some((m) => m.name.includes('MCP')));
}

// ═══════════════════════════════════════════════════════════════
// 【10】技术架构画布加料后的结构不变量 —— 加料不能加出坏图
// ═══════════════════════════════════════════════════════════════
console.log('\n【10】技术架构画布加料不变量');
{
  for (const preset of presets) {
    const picks = presetPicks(preset.id);
    const arch = buildTechArch(picks, emptyEdits());
    for (const theme of ['dark', 'light'] as const) {
      const svg = buildTechArchSvg(arch, theme, { title: 't', subtitle: 's' });
      // 高度加了页脚：viewBox 的高必须 ≥ 内容高 + 页脚，否则图例压住内容
      const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      check(
        `${preset.name}/${theme}：画布含页脚高度`,
        !!vb && Number(vb[2]) >= arch.height + 62 + 40,
        vb ? `viewBox 高 ${vb[2]} < ${arch.height + 102}` : 'viewBox 未解析'
      );
      // 图例与署名必须在
      check(`${preset.name}/${theme}：含页脚图例`, svg.includes('调用 / 数据流'));
      check(`${preset.name}/${theme}：含出处署名`, svg.includes('杨先生的军火库 · arsenal'));
      // 分区计数 chip：每个分区一个「N 节点」
      check(
        `${preset.name}/${theme}：分区计数 chip 数 = 分区数`,
        (svg.match(/节点<\/text>/g) ?? []).length === arch.zones.length
      );
      // 无标题（交互态）签名在页脚而不是标题行
      const hooksSvg = buildTechArchSvg(arch, theme, {});
      check(`${preset.name}/${theme}：无标题时页脚署名`, hooksSvg.includes('杨先生的军火库 · arsenal'));
      break; // 每个预设验 dark 即可，light 抽 cloud 预设已覆盖
    }
    break; // 结构断言对预设不敏感，standard 通过即可；下面用 cloud 补 light
  }
  const cloudSvg = buildTechArchSvg(buildTechArch(presetPicks('cloud'), emptyEdits()), 'light', {
    title: 't',
  });
  check('cloud/light：加料产物含分区强调色', cloudSvg.includes('#5A9FD4'));
}

// ═══════════════════════════════════════════════════════════════
// 【11】图标库与动效 —— 图标 key 拼错会静默回落，动效不许破坏导出
// ═══════════════════════════════════════════════════════════════
console.log('\n【11】图标库与动效');
{
  // ① 视图层引用的每个图标 key 都必须真的注册过 —— 拼错会静默回落到
  //    spark，图上就多出一排一模一样的星形，而且没人报错
  const usedInView = [
    ...['dict', 'blueprint', 'assemble', 'verify', 'deliver'],
    ...['human', 'ai', 'lint', 'server'],
    ...['rulesDb', 'cookDb', 'stackDb', 'pen', 'gear', 'sync'],
    ...['browser', 'deliver', 'anchor', 'crossCheck', 'flag', 'lock', 'pipe'],
    ...['lib', 'plug', 'datasource', 'handshake', 'scale'],
    ...['search', 'compare', 'layers', 'regex', 'tree', 'brain', 'gauge', 'noGo'],
    ...['folderRules', 'folderCook', 'folderStack', 'folderWeb', 'folderServer', 'folderTools', 'folderDocs', 'folderProfiles'],
    ...['key', 'clock', 'spark'],
  ];
  const missing = usedInView.filter((k) => !(k in ARCH_GLYPHS));
  check(`架构视图：引用的 ${usedInView.length} 个图标 key 全部注册`, missing.length === 0, `缺: ${missing.join(',')}`);
  check('图标库：无空图形（每个图标至少一段 path）', Object.values(ARCH_GLYPHS).every((g) => g.includes('<path') || g.includes('<circle') || g.includes('<rect')));

  // ② 技术组件图标库扩充后仍在合法 kind 内
  // actor / topology 是第二批加的两类：角色与外部系统、集群形态。
  // 不塞进 infra/tool 是因为图例会把它们混进技术组件堆里，看不出「谁在用」和「几个」。
  const kinds = new Set(['runtime', 'db', 'cache', 'mq', 'registry', 'doc', 'security', 'observe', 'infra', 'tool', 'none', 'actor', 'topology']);
  check(
    'tech-icons：全部 kind 合法',
    Object.values(TECH_ICONS).every((t) => kinds.has(t.kind)),
    `非法 kind: ${[...new Set(Object.values(TECH_ICONS).map((t) => t.kind))].filter((k) => !kinds.has(k)).join('、')}`
  );
  check(
    `tech-icons：数量 ≥ 168（89 个技术件 + 81 个架构概念，实到 ${Object.keys(TECH_ICONS).length}）`,
    Object.keys(TECH_ICONS).length >= 168
  );
  // 每个图标都得有图形：空 svg 在图上就是一个看不见的点，同样不报错
  const emptyIcons = Object.entries(TECH_ICONS).filter(([, v]) => !v.svg || !v.svg.includes('<'));
  check(
    'tech-icons：无空图形',
    emptyIcons.length === 0,
    `空: ${emptyIcons.map(([k]) => k).join('、')}`
  );

  // ③ 动效样式表：内嵌 + 降级两样都在
  const css = svgMotionStyle();
  check('arch-motion：样式表含 am- 前缀动画', css.includes('.am-rise') && css.includes('@keyframes am-run'));
  check('arch-motion：含 prefers-reduced-motion 降级', css.includes('prefers-reduced-motion'));

  // ④ 交付图动效契约：无 hooks（导出）带动画，hooks（交互）不带 ——
  //    拖拽时元素在动会影响手感，且每次重绘都重放入场
  const still = buildTechArchSvg(buildTechArch(presetPicks('standard'), emptyEdits()), 'dark', { title: 't' });
  const live = buildTechArchSvg(buildTechArch(presetPicks('standard'), emptyEdits()), 'dark', { hooks: true });
  check('画布动效：导出态含 am-run 流光', still.includes('class="am-run"'));
  check('画布动效：导出态含节点 stagger 入场', still.includes('class="am-rise"'));
  check('画布动效：交互态不含任何 am- 动画', !live.includes('am-'));

  // ⑤ 图标资产库（第二批：81 个「非技术组件」+ 一条新的事实源链路）
  //
  // 这一组守的是同一件事的两头：**清单 ↔ 磁盘 ↔ 矢量表**。
  // 三者任一处脱节，界面上都不会报错 —— 页面照样列出 81 行，
  // 只是其中几行的图标是个灰方块（iconSvg 查不到就静默回落到 generic）。
  const webRoot = path.resolve(here, '..');
  const iconsDir = path.join(webRoot, 'public', 'icons');
  const iconIds = iconAssets.map((i) => i.key);

  // ① key 唯一：复制粘贴忘改 key 是最常见的一种，且不会有任何提示
  const dupIconKeys = iconIds.filter((k, idx) => iconIds.indexOf(k) !== idx);
  check(
    `图标库：${iconAssets.length} 个 key 无重复`,
    dupIconKeys.length === 0,
    `重复: ${[...new Set(dupIconKeys)].join('、')}`
  );

  // ② 登记了位图 → 磁盘上必须有（页面破图就出在这一步）
  const missingBitmap = iconAssets.filter((i) => i.bitmap && !fs.existsSync(path.join(iconsDir, i.bitmap)));
  check(
    `图标库：${iconAssets.filter((i) => i.bitmap).length} 张已登记位图都在盘上`,
    missingBitmap.length === 0,
    `缺: ${missingBitmap.map((i) => `public/icons/${i.bitmap}`).join('、')}`
  );

  // ③ 反向：盘上的图必须都被登记（生成了却没人用 = 白生成）
  const walkIcons = (dir: string, prefix: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          return e.isDirectory() ? walkIcons(path.join(dir, e.name), rel) : [rel];
        })
      : [];
  const onDisk = walkIcons(iconsDir, '');
  const registered = new Set(iconAssets.map((i) => i.bitmap).filter(Boolean));
  const orphanBitmaps = onDisk.filter((rel) => !registered.has(rel));
  check(
    `图标库：public/icons 下 ${onDisk.length} 个文件全部已登记`,
    orphanBitmaps.length === 0,
    `孤儿: ${orphanBitmaps.join('、')}`
  );

  // ④ 矢量 key 必须真的在 TECH_ICONS 里 —— 这是「灰方块」的唯一来源
  const badVector = iconAssets.filter((i) => !(i.vector in TECH_ICONS));
  check(
    `图标库：${iconAssets.length} 条矢量 key 全部命中 TECH_ICONS`,
    badVector.length === 0,
    `查不到（页面会静默回落 generic）: ${badVector.map((i) => `${i.key}→${i.vector}`).join('、')}`
  );

  // ⑤ 分类必须落在九大类内，且九大类不许空着
  const catIds = new Set(ICON_CATEGORIES.map((c) => c.id));
  const badCat = iconAssets.filter((i) => !catIds.has(i.category));
  check('图标库：分类全部合法', badCat.length === 0, `非法分类: ${badCat.map((i) => `${i.key}→${i.category}`).join('、')}`);
  const emptyCats = ICON_CATEGORIES.filter((c) => !iconAssets.some((i) => i.category === c.id));
  check(
    `图标库：${ICON_CATEGORIES.length} 个分类都非空`,
    emptyCats.length === 0,
    `空分类（侧栏点了没反应）: ${emptyCats.map((c) => c.id).join('、')}`
  );

  // ⑥ 渲染器里写死的图标 key 也必须查得到 —— 与 ④ 是同一个坑的两侧：
  //    ④ 查的是数据（icons.json），⑥ 查的是代码。`iconSvg('ngnix')` 这种
  //    拼写错误编译得过、跑得起来、控制台一个错都没有，只会多一个灰方块。
  const srcRoots = ['lib', 'app', 'components'].map((d) => path.join(webRoot, 'src', d));
  const iconRefs = new Map<string, string>();
  const walkSrc = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) walkSrc(full);
      else if (/\.tsx?$/.test(e.name)) {
        const text = fs
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        for (const m of text.matchAll(/icon(?:Svg|Name|Color)?\(\s*'([a-z0-9-]+)'/g)) {
          iconRefs.set(m[1], path.relative(webRoot, full));
        }
        for (const m of text.matchAll(/\bicon:\s*'([a-z0-9-]+)'/g)) {
          iconRefs.set(m[1], path.relative(webRoot, full));
        }
      }
    }
  };
  for (const r of srcRoots) walkSrc(r);
  const unresolvable = [...iconRefs.keys()].filter((k) => !(k in TECH_ICONS));
  check(
    `图标库：代码里引用的 ${iconRefs.size} 个 key 全部可解析`,
    unresolvable.length === 0,
    `拼错或已删（会静默变灰方块）: ${unresolvable.map((k) => `${k}@${iconRefs.get(k)}`).join('、')}`
  );

  // ⑦ 架构图数据里声明的 icon 同样要能解析（数据在 JSON 里，上面那条扫不到）
  const archDoc = JSON.parse(
    fs.readFileSync(path.join(here, '..', 'src', 'generated', 'architecture.json'), 'utf8')
  );
  const archIcons = new Set<string>();
  // 图标挂在 canvas.options 下（不是 options）—— 早先按 options 去取，
  // 取到 0 条，断言「0 个引用全部可解析」绿得毫无意义。
  const canvasOpts = (archDoc.canvas?.options ?? {}) as Record<string, Record<string, { icon?: string }>>;
  for (const opts of Object.values(canvasOpts)) {
    for (const spec of Object.values(opts)) if (spec.icon) archIcons.add(spec.icon);
  }
  const badArchIcons = [...archIcons].filter((k) => !(k in TECH_ICONS));
  check(
    `架构图数据：${archIcons.size} 个 icon 引用全部可解析`,
    badArchIcons.length === 0,
    `查不到: ${badArchIcons.join('、')}`
  );
  // 下限闸门：只取到 0 条时上面那条会「0 个引用全部可解析」地绿过去，
  // 等于什么都没验。这条保证我们确实读到了图标表，而不是读了个空对象。
  check(
    `架构图数据：确实取到了图标表（实到 ${archIcons.size} 个 key）`,
    archIcons.size >= 40,
    '取不到说明读错了字段位置，上面的「全部可解析」就成了空话'
  );

  // ⑧ 位图体积闸门：二进制最容易悄悄把仓库顶大
  const totalBytes = onDisk.reduce((n, rel) => n + fs.statSync(path.join(iconsDir, rel)).size, 0);
  check(
    `图标库：位图总 ${(totalBytes / 1024).toFixed(0)}KB ≤ 6MB`,
    totalBytes <= 6 * 1024 * 1024
  );

  // ⑨ 页面与菜单成对存在（和【13】分工：那条防「菜单指向空地址」，这条防「图标库页面被忘挂」）
  check('图标库：/icons 页面存在', fs.existsSync(path.join(webRoot, 'src', 'app', 'icons', 'page.tsx')));
  const shellNav = fs.readFileSync(path.join(webRoot, 'src', 'components', 'Shell.tsx'), 'utf8');
  check('图标库：侧栏有入口', /href:\s*'\/icons'/.test(shellNav));
}

// ═══════════════════════════════════════════════════════════════
// 【12】交付与运行：结构树画出来的文件，导出包里必须真有
//
// 这一条守的是「照图找文件」这条信任链。deploy/ 下的文件名是生成器与结构树
// 各写一份的 —— 一边多一边少时，界面、zip、构建脚本都不会报错，
// 只有照着结构图去找文件的人会发现：图上写着 deploy/chart/templates/hpa.yaml，
// 解出来的包里却没有。这种错不会红，只会消耗信任。
// ═══════════════════════════════════════════════════════════════
console.log('\n【12】交付与运行清单');
{
  // 目录名以 / 结尾（这是结构树的约定），拼路径时要先把斜杠去掉 ——
  // 否则会得到 deploy//Dockerfile，看起来像两边不一致，其实是我自己拼错了
  const flat = (nodes: TreeNode[], prefix: string, out: string[]) => {
    for (const n of nodes) {
      const here = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.kind === 'dir') flat(n.children ?? [], here.replace(/\/$/, ''), out);
      else out.push(here);
    }
    return out;
  };

  for (const opt of ['jar', 'docker', 'k8s', 'helm']) {
    // 用「只填交付维」之外的标准预设做底盘，只换交付形态，
    // 这样差出来的文件就只可能是交付形态带来的
    const base = presetPicks('standard');
    const picks: StackPicks = { ...base, deploy: opt };
    const audit = auditArchitecture(picks);
    const plan = buildExportPlan(picks, audit);

    // 09-28 十反馈（货不对版）：树改为从导出清单合成，对照升级到**全量** ——
    // 过去只对齐 deploy/ 前缀，src 下「树画了但包里没有」的业务示例文件漏网
    const inTree = flat(
      treeFromFiles(plan.files.map((f) => ({ path: f.path })), 'x/').children ?? [],
      '',
      []
    ).sort();
    const inPack = plan.files.map((f) => f.path).sort();

    check(
      `${opt}：结构树画出 ${inTree.length} 个文件`,
      inTree.length > 0,
      '结构树里什么都没有 —— 导出清单没落进树'
    );
    check(
      `${opt}：导出包与结构树逐一对齐（全量）`,
      inTree.join('|') === inPack.join('|'),
      `树有包没有: ${inTree.filter((p) => !inPack.includes(p)).join('、') || '无'}；` +
      `包有树没有: ${inPack.filter((p) => !inTree.includes(p)).join('、') || '无'}`
    );
    check(
      `${opt}：每个文件都有内容`,
      plan.files.filter((f) => f.path.startsWith('deploy/')).every((f) => f.content.trim().length > 80),
      '有文件短到不像真配置'
    );
  }

  // Secret 里不许出现真值 —— 生成带密码的文件交出去，等于教人把密钥提交进 Git
  const k8s = { ...presetPicks('standard'), deploy: 'k8s' } as StackPicks;
  const secret = buildExportPlan(k8s, auditArchitecture(k8s))
    .files.find((f) => f.path.endsWith('02-secret.yaml'));
  check('Secret 不带真值（只留键与占位符）', !!secret && /:\s*""\s*$/m.test(secret.content),
    secret ? secret.content.split('\n').slice(-6).join(' / ') : '找不到 secret 文件');

  // 探针端点跟着选型走，不是生成器的固定模板
  //
  // Spring Boot 有 /actuator/health 的前提是引入了 Actuator。没选它却写死这个路径，
  // 产物看着专业、apply 上去 Pod 永远 NotReady —— 那是「生成的清单不能跑」，
  // 比诚实地说「没有健康端点」糟得多。这条断言守的就是不许伪造端点。
  const withActuator = { ...presetPicks('standard'), deploy: 'k8s', observability: 'actuator' } as StackPicks;
  const woActuator = { ...presetPicks('standard'), deploy: 'k8s', observability: 'none' } as StackPicks;
  const dep = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p)).files.find((f) => f.path.endsWith('04-deployment.yaml'))!;

  check('有 Actuator → 探针指向 /actuator/health/readiness',
    dep(withActuator).content.includes('/actuator/health/readiness'));
  check('没有 Actuator → 不出现未注释的 actuator 探针',
    !/^\s+readinessProbe:/m.test(dep(woActuator).content) &&
      !dep(woActuator).content.includes('path: /actuator/health'),
    dep(woActuator).content.split('\n').filter((l) => l.includes('actuator')).slice(0, 2).join(' / ') || '');
  check('没有 Actuator → 探针段落留成注释且说明怎么办',
    /#\s*readinessProbe:/.test(dep(woActuator).content) &&
      dep(woActuator).content.includes('没有 Actuator'),
    '要么整段消失（无从下手），要么照旧写死（起不来）');

  // Compose 的健康检查同理：没有端点就别让容器永远 unhealthy。
  // 注意不能只找 `healthcheck:` —— mysql / redis 这些中间件服务也各自带了一段，
  // 那条断言会恒真。要看的是端点本身在不在。
  const composeOf = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p)).files.find((f) => f.path.endsWith('docker-compose.yml'))!;
  check('Compose：有 Actuator 时健康检查打在 /actuator/health 上',
    composeOf({ ...presetPicks('standard'), deploy: 'docker' } as StackPicks).content.includes('/actuator/health'));
  // 看「生效的那一行」而不是整个文件：说明性注释里也会提到这个路径，
  // 整文件搜字符串会把注释算进去，断言恒真 —— 那等于没写。
  check('Compose：没有 Actuator 时不写 actuator 健康检查',
    !/^\s+test:.*\/actuator\/health/m.test(
      composeOf({ ...presetPicks('standard'), deploy: 'docker', observability: 'none' } as StackPicks).content
    ));

  // 端口不许两边写死：清单里的 containerPort 必须与 application.yml 同源。
  // 生成器读的是 renderYaml 的输出，这里读的是导出包里的 application.yml ——
  // 两边对不上就说明有人把 8080 抄进了清单，改端口时部署会静默失配。
  const appYml = buildExportPlan(k8s, auditArchitecture(k8s))
    .files.find((f) => f.path === 'src/main/resources/application.yml')!.content;
  const ymlPort = /^\s{2}port:\s*(\d+)\s*$/m.exec(appYml);
  check(
    'Deployment 的 containerPort 与 application.yml 同源',
    !!ymlPort && dep(k8s).content.includes(`containerPort: ${ymlPort[1]}`),
    ymlPort ? `yml=${ymlPort[1]}` : 'yml 里没找到 server.port'
  );

  // 交付形态为空时，不产生任何部署文件 —— 没选就是没选，不替用户猜
  const none = { ...presetPicks('standard'), deploy: '' } as StackPicks;
  const nonePlan = buildExportPlan(none, auditArchitecture(none));
  check('未选交付形态时不产出部署文件',
    nonePlan.files.every((f) => !f.path.startsWith('deploy/')));

  const H = { ...presetPicks('standard'), deploy: 'helm' } as StackPicks;

  // ── Helm 模板必须真的被模板化 ────────────────────────────
  //
  // 这一组是那次自检查出来的 P0 的回归围栏：曾经 service.yaml 是拿原生清单
  // 做 `.replace(/^name: .*$/m, ...)` 生成的，而文件里是带缩进的 `  name:`，
  // 正则根本没匹配上 —— 于是 Service 名字与 selector 全是写死的，
  // Deployment 用 fullname、Service 用裸名，装完选不到 Pod、Ingress 指向空后端，
  // **而且不报任何错**。这类错只有照着资源名一个个比对才能发现，必须机器守。
  const helmTpl = (name: string) =>
    buildExportPlan(H, auditArchitecture(H)).files.find((f) => f.path.endsWith(`templates/${name}`))!;

  for (const t of ['deployment.yaml', 'service.yaml', 'ingress.yaml', 'configmap.yaml',
    'hpa.yaml', 'pdb.yaml', 'secret.yaml', 'serviceaccount.yaml']) {
    const c = helmTpl(t).content;
    check(`Helm ${t}：资源名走 fullname，不许写死`,
      /name:\s*\{\{\s*include\s+"[^"]+\.fullname"/.test(c),
      c.split('\n').find((l) => /^\s*name:/.test(l)) ?? '找不到 name 行');
    check(`Helm ${t}：标签走 helpers，不许散着写`,
      !/^\s{4}app:\s*[a-z0-9-]+\s*$/m.test(c),
      '标签写死会让 Service 选不到 Pod：Deployment 与 Service 差一个字符就永远不通');
  }

  // values ↔ 模板双向：模板引用的键必须存在（反向见下面 env 那一条）
  const valsTxt = buildExportPlan(H, auditArchitecture(H))
    .files.find((f) => f.path.endsWith('chart/values.yaml'))!.content;
  // 顶层键是**零缩进**的。写成 `^\s{2}` 会抓到 replicaCount 下面的
  // repository / pullPolicy 这些嵌套键，于是 replicaCount 反而被判成「不存在」——
  // 断言自己写错了，跑出来一片红，比没有断言更浪费信任。
  const keysOf = (txt: string) =>
    [...txt.matchAll(/^([a-zA-Z][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
  const topKeys = new Set(keysOf(valsTxt));
  for (const t of ['deployment.yaml', 'service.yaml', 'ingress.yaml', 'hpa.yaml', 'pdb.yaml']) {
    for (const m of helmTpl(t).content.matchAll(/\.Values\.([A-Za-z0-9_]+)/g)) {
      check(`Helm ${t}：.Values.${m[1]} 在 values.yaml 里有定义`, topKeys.has(m[1]),
        `values.yaml 顶层键: ${[...topKeys].join('、')}`);
    }
  }

  // 三份 values 的键必须是主 values 的子集 —— 拼错的键会被 Helm 静默忽略
  for (const envFile of ['values-dev.yaml', 'values-prod.yaml']) {
    const txt = buildExportPlan(H, auditArchitecture(H))
      .files.find((f) => f.path.endsWith(`chart/${envFile}`))!.content;
    const flat = (t: string) => keysOf(t);
    const orphan = [...new Set(flat(txt))].filter((k) => !topKeys.has(k));
    check(`${envFile}：每个键都在主 values 里存在`, orphan.length === 0,
      orphan.length ? `静默无效的键: ${orphan.join('、')}` : '');
  }

  // 选型声明的环境变量必须真的进了 chart —— 否则装上去连不上数据库，
  // 而且要等到运行时才暴露
  check('Helm values 的 env 段来自选型，不是一行写死',
    (valsTxt.match(/^\s{2}[A-Z][A-Z0-9_]+:/gm) ?? []).length >= 2,
    valsTxt.split('\n').filter((l) => /^\s{2}[A-Z][A-Z0-9_]+:/.test(l)).join(' / ') || 'env 段为空');

  // ── Dockerfile 不许依赖导出包里没有的东西 ──────────────────
  //
  // ./mvnw 是最典型的一个：导出包只有 pom.xml 与 src，没有 wrapper，
  // 写 ./mvnw 会让第一次 docker build 就挂在 not found 上。
  const dockerfileOf = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p)).files.find((f) => f.path === 'deploy/Dockerfile')!;
  for (const b of ['maven', 'gradle']) {
    const p = { ...presetPicks('standard'), deploy: 'docker', build: b } as StackPicks;
    const c = dockerfileOf(p).content;
    // 只看**非注释行**：说明里会提到 ./mvnw 这个反例，整文件搜会把注释算成违规
    const code = c.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    check(`Dockerfile（${b}）：不依赖导出包里没有的 wrapper`,
      !/\.\/mvnw|\.\/gradlew/.test(code),
      code.split('\n').find((l) => /mvnw|gradlew/.test(l)) ?? '');
    check(`Dockerfile（${b}）：构建阶段有构建工具，运行阶段是纯 JRE`,
      /AS builder/.test(c) && /-jre-/.test(c),
      '构建阶段要能编译，运行阶段不许带编译器');
    // 只约束**运行阶段**的 COPY（--from=builder）。构建阶段本来就是 root，
    // 给它也加 --chown 只是噪音。
    // 注意 --chown 与 --from 的顺序：生成器写的是 `COPY --chown=... --from=builder`，
    // 写成 `^COPY --from` 会一条都匹配不到，断言恒假
    const runtimeCopies = code.split('\n').filter((l) => /^COPY\b.*--from=builder/.test(l));
    check(`Dockerfile（${b}）：运行阶段的 COPY 带 --chown，USER 之后还能写文件`,
      runtimeCopies.length > 0 && runtimeCopies.every((l) => l.includes('--chown')),
      runtimeCopies.find((l) => !l.includes('--chown')) ?? '没有从 builder 复制产物');
  }

  // ── Makefile 的 target 必须与交付形态匹配 ──────────────────
  const mkOf = (deploy: string) =>
    buildExportPlan({ ...presetPicks('standard'), deploy } as StackPicks,
      auditArchitecture({ ...presetPicks('standard'), deploy } as StackPicks))
      .files.find((f) => f.path === 'deploy/Makefile')!.content;
  const mkDocker = mkOf('docker');
  const mkK8s = mkOf('k8s');
  check('Makefile：docker 形态才有 up / down',
    /^up:/m.test(mkDocker) && !/^up:/m.test(mkK8s),
    'k8s 形态没有 compose 文件，留着 up 就是一条必然失败的命令');
  check('Makefile：k8s 形态才有 rollback / status',
    /^rollback:/m.test(mkK8s) && !/^rollback:/m.test(mkDocker));
  check('Makefile：k8s 用 apply -k（否则 kustomization 的 namespace 不生效）',
    /kubectl apply -k/.test(mkK8s),
    mkK8s.split('\n').find((l) => l.includes('kubectl apply')) ?? '找不到 apply');
  for (const [name, txt] of [['docker', mkDocker], ['k8s', mkK8s]] as const) {
    const phony = /\.PHONY:\s*(.+)/.exec(txt)?.[1].split(/\s+/).filter(Boolean) ?? [];
    const defined = [...txt.matchAll(/^([a-z][a-z-]*):/gm)].map((m) => m[1])
      .filter((t) => t !== 'help' || true);
    const missing = defined.filter((t) => !phony.includes(t));
    check(`Makefile（${name}）：每个 target 都在 .PHONY 里`, missing.length === 0,
      missing.length ? `漏了: ${missing.join('、')}` : '');
  }
  check('Makefile：TAG 在没有 git 的目录里不会变成空',
    /git rev-parse[^)]*\|\|/.test(mkK8s), 'TAG 空会让镜像 tag 变成 registry/app:');

  // ── Compose：依赖方向与数据源 ────────────────────────────
  //
  // 三件事都是自检查出来的、而且都不会报错：
  //   ① 应用 depends_on 了 prometheus，而 prometheus 又 depends_on 应用 → 成环，起不来
  //   ② SPRING_DATASOURCE_URL 写死 mysql → 选了 postgres 会连一个不存在的主机
  //   ③ 挂了 deploy/prometheus.yml 却没生成它 → Docker 挂个同名目录进去
  const compose = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p)).files.find((f) => f.path.endsWith('docker-compose.yml'))!
      .content;
  const composeFiles = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p)).files.filter((f) => f.path.startsWith('deploy/'));

  const stdCompose = compose({ ...presetPicks('standard'), deploy: 'docker' } as StackPicks);
  const appBlock = /^  arsenal-demo:[\s\S]*?(?=^  \S|\Z)/m.exec(stdCompose)![0];
  check('Compose：应用不等观测组件（否则 应用→prometheus→应用 成环）',
    !/prometheus/.test(appBlock),
    '观测组件是来抓应用的，不是应用的下游；成环会让 docker compose 直接报 cycle');
  check('Compose：等待条件用长语法，等健康而不只是等启动',
    /condition: service_healthy/.test(appBlock),
    '短语法只保证容器起来了，不保证能连上');

  for (const db of ['mysql', 'postgres']) {
    const c = compose({ ...presetPicks('standard'), deploy: 'docker', database: db } as StackPicks);
    const url = /SPRING_DATASOURCE_URL:\s*(\S+)/.exec(c)?.[1] ?? '';
    check(`Compose：database=${db} 时 JDBC URL 指向 ${db}`, url.includes(db),
      `实际是 ${url || '（没写）'} —— 连一个 compose 里不存在的主机`);
  }

  // 挂载进容器的文件必须真的在导出包里 —— 少一个文件，容器起不来
  const prom = composeFiles({ ...presetPicks('standard'), deploy: 'docker' } as StackPicks)
    .map((f) => f.path);
  check('Compose：选了 prometheus 就一起生成 prometheus.yml',
    prom.includes('deploy/prometheus.yml'),
    `实际: ${prom.join('、')}`);
  for (const m of stdCompose.matchAll(/- (\.\/[A-Za-z0-9_.-]+):/g)) {
    check(`Compose 挂载的 ${m[1]} 在导出包里存在`,
      prom.includes(`deploy/${m[1].replace('./', '')}`),
      '挂不存在的文件时 Docker 会建一个同名目录，容器起不来且报错与真实原因无关');
  }

  // 优雅停机时长不许写死：必须比 application.yml 里的应用侧超时大
  const shutdownOf = (p: StackPicks) => {
    const files = buildExportPlan(p, auditArchitecture(p)).files;
    const yml = files.find((f) => f.path === 'src/main/resources/application.yml')!.content;
    const dep = files.find((f) => f.path.endsWith('04-deployment.yaml'))?.content ?? '';
    return {
      app: Number(/timeout-per-shutdown-phase:\s*(\d+)s/.exec(yml)?.[1] ?? 0),
      k8s: Number(/terminationGracePeriodSeconds:\s*(\d+)/.exec(dep)?.[1] ?? 0),
    };
  };
  const sd = shutdownOf({ ...presetPicks('standard'), deploy: 'k8s' } as StackPicks);
  check('Deployment 的停机总时长大于应用侧超时',
    sd.app > 0 && sd.k8s > sd.app,
    `应用侧 ${sd.app}s / 总预算 ${sd.k8s}s —— 相等等于没给信号传播留时间`);

  const unit = buildExportPlan({ ...presetPicks('standard'), deploy: 'jar' } as StackPicks,
    auditArchitecture({ ...presetPicks('standard'), deploy: 'jar' } as StackPicks))
    .files.find((f) => f.path.endsWith('app.service'))!.content;
  const stop = Number(/TimeoutStopSec=(\d+)s/.exec(unit)?.[1] ?? 0);
  check('systemd 的 TimeoutStopSec 大于应用侧超时', stop > sd.app,
    `TimeoutStopSec=${stop}s / 应用侧 ${sd.app}s`);
}

// ═══════════════════════════════════════════════════════════════
// 【13】导航与页签契约 —— 源码级，守「按钮在、点进去是空的」这类错
//
// 这一节存在的理由是一个真实事故：装配台「拆菜单」时把技术架构图迁到了
// /arch，但 TabId 与页签条里那一项漏删，渲染分支又没有 —— 页签按钮留在
// 那儿，点进去一片空白，控制台一个错都不报，六层校验全绿。
//
// 同样这类错还有：新增路由忘了进 NAV（页面存在但没人找得到）、
// 定义了 savePicksSnapshot 却从没调用（跨页契约无声断开）。
// 全是「代码语法完全正确、功能不存在」，只有把源码本身当数据来断言才抓得住。
// ═══════════════════════════════════════════════════════════════
console.log('\n【13】导航与页签契约');
{
  const src = (rel: string) => fs.readFileSync(path.resolve(here, '..', 'src', rel), 'utf8');

  // 断言读的是源码文本，注释里出现的 `tab === 'x'`（文档举例）会被当成真分支 ——
  // 这一节自己就踩过：第一版把注释里的示例算成了一个「无法被点亮的页签」。
  // 解析前一律去注释，注释不算代码。
  const code = (rel: string) =>
    src(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

  // ① 导航 ↔ 路由：NAV 里指过去的每个地址都得真有一个页面。
  // 2026-10-05 拆细菜单后，「装配台」的页→步两级菜单数据（STACK_NAV）与
  // 十条步骤路由（StepSpec.route）都住在 wizard.ts，Shell 只消费 ——
  // 地址要从两处收集，只扫 Shell 会把十条步骤路由漏在契约外面。
  const shell = code('components/Shell.tsx');
  const wizardSrc = code('app/stack/wizard.ts');
  // wizard 的 STACK_PAGES 页路由与 Shell 的 href 重复 → 必须去重，
  // 否则 ③ 的高亮表会把同一条路由点亮两次（hits.length !== 1 假红）。
  const navHrefs = [
    ...new Set([
      ...[...shell.matchAll(/\{\s*href:\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...wizardSrc.matchAll(/\broute:\s*'([^']+)'/g)].map((m) => m[1]),
    ]),
  ];
  const pageExists = (href: string) =>
    href === '/'
      ? fs.existsSync(path.resolve(here, '../src/app/page.tsx'))
      : fs.existsSync(path.resolve(here, '../src/app', href.replace(/^\//, ''), 'page.tsx'));
  const dangling = navHrefs.filter((h) => !pageExists(h));
  check(`导航：${navHrefs.length} 个入口都指向真实页面`, dangling.length === 0, `指向空地址: ${dangling.join('、')}`);

  // ② 反向：页面目录不许成为孤儿（动态段与「有意不进导航」的除外）
  //
  // ORPHAN_OK = **有意**不进导航的页面，逐条写出来并写明理由。
  // 白名单存在的意义：删掉这条豁免时会红（说明那个页面真需要入口了），
  // 而新增一个「反正没人从导航点它」的页面时不会红（那才是要防的事）。
  const ORPHAN_OK = new Set<string>([
    // /charter → /standards 重定向后的迁移页（2026-10-05）。它只给旧书签跳转用，
    // 侧栏留两个入口等于两个心智模型。有 meta refresh，不靠人点。
    '/charter',
    // /arch → /autopsy 重定向后的迁移页（2026-10-17 架构图谱合并棒3）。六视图与
    // 可拖拽画布整体并进项目侦察的架构面板后，原画廊页只给旧书签跳转用；
    // 它仍是矩阵里的页面（截图验它真跳），但不该在侧栏占第二个入口。
    '/arch',
  ]);
  const appDir = path.resolve(here, '../src/app');
  const orphans = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.includes('['))
    .map((d) => `/${d.name}`)
    .filter((h) => !navHrefs.includes(h) && !ORPHAN_OK.has(h));
  check('导航：没有孤儿页面（页面存在但导航里没有入口）', orphans.length === 0, `孤儿: ${orphans.join('、')}`);

  // ②′ /arch 退役收口（2026-10-17 架构图谱合并棒3）：迁移页真的会跳，且全仓 src
  //     不许再出现指向 /arch 路由的链接（导航 / <Link> / router.push 都算）。
  //     判据用「引号包住的整串 /arch」：资产路径 `/arch/business.webp`
  //     （public/arch/ 六张封面插画，计划书明确不挪位）不是路由链接，不会误伤；
  //     注释先剥（文档里提一嘴 /arch 不算链接）。
  check(
    '/arch 迁移页真的会跳：meta refresh 指向 /autopsy',
    /url=\/autopsy\//.test(code('app/arch/page.tsx')),
    '迁移页不跳 = 旧书签落在一页不会动的死文字上（照 /charter 先例，它必须真跳）'
  );
  const srcTreeRoot = path.resolve(here, '../src');
  const archLinkResidue: string[] = [];
  const walkSrcForArchLinks = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkSrcForArchLinks(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        if (/['"]\/arch['"]/.test(code(path.relative(srcTreeRoot, p)))) {
          archLinkResidue.push(path.relative(srcTreeRoot, p));
        }
      }
    }
  };
  walkSrcForArchLinks(srcTreeRoot);
  check(
    '退役收口：src 全仓没有指向 /arch 路由的链接（封面插画 /arch/*.webp 是资产路径，不算）',
    archLinkResidue.length === 0,
    `残留: ${archLinkResidue.join('、') || '无'} —— 漏一处的后果是用户点进一张迁移页，而断言全绿`
  );

  // ③ 导航高亮：判定必须按**路径边界**，而且判据只有一份
  //
  // 修之前的样子是 `pathname.startsWith(href)` —— 裸前缀。`/archify`（出图服务）与
  // `/arch`（架构图谱）只差一串后缀，于是点「出图服务」时「架构图谱」跟着一起高亮。
  // 语法完全正确、控制台一个错都不报，只有把判定函数**当数据跑一遍**才抓得住。
  //
  // 两条缺一不可：表驱动测的是「判据的行为」，但要是有人把判据抄一份回 Shell.tsx 自己用，
  // 表驱动照样全绿、页面已经错了 —— 所以要再钉一条「页面用的是这一份」。
  check(
    '导航高亮：判据只有一份（Shell 调 isNavActive，不自己写）',
    shell.includes('isNavActive('),
    'Shell 自己写了一份判定 → 下面那条表驱动测的就不是页面真正用的那个函数了'
  );
  // 场景库三层路由（2026-09-26 第 2 棒）：`[caseId]` 是二层子路径，
  // 高亮判定是路径边界匹配，`/cases/<真实场景 id>` 必须仍然只点亮「场景库」这一项。
  // （2026-10-17 架构图谱合并棒3：`/arch/any-view` 随 /arch 退役一并移除 ——
  //  导航里没有 /arch 了，这条路由的点亮期望从「恰好 1 项」变成「0 项」，
  //  留着就是一条必红的死数据。）
  const navRoutes = [
    ...navHrefs,
    '/rules/WEB-DTO-001',
    '/cases/any-page',
    '/cases/hotspot-cache',
  ];
  const highlight = navRoutes.map((r) => ({
    route: r,
    hits: navHrefs.filter((h) => isNavActive(r, h)),
  }));
  const wrongHit = highlight.filter((h) => h.hits.length !== 1);
  check(
    `导航高亮：${navRoutes.length} 个路由各恰好点亮 1 项`,
    wrongHit.length === 0,
    wrongHit.map((w) => `${w.route} → ${w.hits.length} 项（${w.hits.join('、') || '无'}）`).join('；')
  );

  // ③′ 步骤路由 ↔ 页容器（2026-10-05 拆细菜单）：十条 /stack/step/<id> 页面
  // 各自把「路由对应的步」钉进容器 —— 复制粘贴错一个 id，菜单点进去就是
  // 别人的步骤，而且不报任何错。判据：page.tsx 里 stepPageMeta 与 <StepPage id=
  // 用的是同一个 id，且目录名就是那个 id（路径即路由）。
  const STEP_ROUTE_IDS = [
    'project', 'base', 'theme', 'layers',
    'frontend', 'env', 'modules',
    'deliverRun', 'topology', 'delivery',
  ];
  const stepPageBad = STEP_ROUTE_IDS.filter((id) => {
    const p = path.resolve(here, '../src/app/stack/step', id, 'page.tsx');
    if (!fs.existsSync(p)) return true;
    const s = fs.readFileSync(p, 'utf8');
    return !s.includes(`stepPageMeta('${id}')`) || !s.includes(`id="${id}"`);
  });
  check(
    `步骤路由：${STEP_ROUTE_IDS.length} 个 /stack/step/<id> 页面各自钉住自己的步`,
    stepPageBad.length === 0,
    `钉错步或缺文件: ${stepPageBad.join('、')}`
  );

  // ④ 装配台页签三处必须同时成立：TabId 类型、页签条数组、渲染分支
  //
  // P0 四页（2026-09-29）：StackComposer.tsx 已拆成四页容器，产物区（页签的家）
  // 整体搬进 StackDelivery.tsx —— 三处仍在同一文件，判据一条没动。
  const composer = code('app/stack/StackDelivery.tsx');
  const idUnion = [
    ...(
      /type TabId\s*=([\s\S]*?);/.exec(composer)?.[1] ?? ''
    ).matchAll(/'([a-z]+)'/g),
  ].map((m) => m[1]);
  const tabBar = [...composer.matchAll(/\{\s*id:\s*'([a-z]+)',\s*glyph:/g)].map((m) => m[1]);
  const branches = [...composer.matchAll(/tab === '([a-z]+)'/g)].map((m) => m[1]);
  const uniq = (xs: string[]) => [...new Set(xs)].sort();

  check(
    `装配台：TabId 与页签条一致（各 ${idUnion.length} / ${tabBar.length} 项）`,
    uniq(idUnion).join(',') === uniq(tabBar).join(','),
    `只在类型里: ${uniq(idUnion).filter((x) => !tabBar.includes(x)).join('、') || '无'}；` +
      `只在页签条里: ${uniq(tabBar).filter((x) => !idUnion.includes(x)).join('、') || '无'}`
  );
  const noBranch = idUnion.filter((id) => !branches.includes(id));
  check(
    `装配台：${idUnion.length} 个页签都有渲染分支`,
    noBranch.length === 0,
    `按钮在、点进去空白: ${noBranch.join('、')}`
  );
  const noType = branches.filter((b) => !idUnion.includes(b));
  check('装配台：渲染分支都在 TabId 里', noType.length === 0, `分支无法被点亮: ${noType.join('、')}`);

  // ⑤ 跨页选型契约：写入点与读取点必须成对存在（写过没人读 = 白写；读没人写 = 永远回落到默认）
  const picksStore = src('lib/picks-store.ts');
  const callers = (fn: string) =>
    ['lib', 'app', 'components']
      .flatMap((dir) => {
        const walk = (p: string): string[] =>
          fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => {
            const full = path.join(p, e.name);
            if (e.isDirectory()) return walk(full);
            return /\.tsx?$/.test(e.name) ? [full] : [];
          });
        return walk(path.resolve(here, '../src', dir));
      })
      .filter((f) => !f.endsWith('picks-store.ts'))
      .filter((f) =>
        fs
          .readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '')
          .includes(`${fn}(`)
      );
  const writers = callers('savePicksSnapshot');
  const readers = callers('loadPicksSnapshot');
  check('选型快照：有写入点（装配台写）', writers.length > 0, '没人写等于画布永远按 standard 预设出图');
  check('选型快照：有读取点（出图服务读）', readers.length > 0, '没人读等于白写');
  check(
    '选型快照：localStorage key 只在一处定义',
    (picksStore.match(/['"]arsenal-stack-picks-v1['"]/g) ?? []).length === 1,
    `实际出现 ${(picksStore.match(/['"]arsenal-stack-picks-v1['"]/g) ?? []).length} 处 —— 两处各自为政时读写会静默对不上`
  );

  // 下面五条守的是同一个盲区：**「有读取点」不等于「该读的人读了」**。
  //
  // 修之前的样子：`loadPicksSnapshot` 的调用者只有 /archify，而装配台 ——
  // 选型的属主 —— 自己不读。于是刷新即回到 standard 预设，而且首帧的写入
  // effect 还会拿 standard 把 localStorage 里 /arch 正要读的那份一起抹掉。
  // 实测（2026-09-23）：塞 `{database:'postgres'}` 进快照，打开 /stack 再刷新，读到的是 mysql。
  // 旧断言只问「有没有人读」，所以它一直是绿的。
  // 同上，装配台自己的恢复逻辑随拆页搬进了 useStackChannel.ts（四页共用的状态通道）
  const stackComposer = code('app/stack/useStackChannel.ts');
  check(
    '装配台自己读快照（属主必须恢复自己的数据）',
    stackComposer.includes('loadSnapshot('),
    '装配台不读快照 → 刷新即回 standard 预设，并覆盖掉 /arch 要读的那一份'
  );
  check(
    '装配台自己恢复基底',
    stackComposer.includes('loadBaseSnapshot('),
    'loadBaseSnapshot 曾经全仓零调用 —— 基底选择永远回到默认值'
  );
  check(
    '装配台自己恢复形态与参数',
    stackComposer.includes('setMeta(snap.meta)'),
    '只恢复选型不恢复形态 → 数据库切了分库分表，图上还是单实例，两边都不报错'
  );

  // 选型出处（provenance）这条通道必须两端都在。只写不读的键仓库里已经有一个
  // （`arsenal-stack-detail-v1`，注释里承诺的「导出 / 粘贴选型」至今没有 UI），
  // 别再攒第二个。
  check(
    '选型出处：有写入路径（扫描入口调 adoptPicks）',
    callers('adoptPicks').length > 0,
    '没人写 → 装配台永远显示不出「这批格子是扫描读出来的」'
  );
  check(
    '选型出处：装配台读它',
    stackComposer.includes('loadProvenance('),
    '写了没人显示 → 用户分不清哪几格是扫描读的、哪几格是自己点的'
  );

  // ⑤ 六视图页签同样守一遍（2026-10-17 棒3：/arch 退役后宿主是 SixViewsPanel；
  //    tech 不在五张静态图里是刻意的 —— 它是可拖拽画布，在「技术架构」子页签，
  //    同一张图上两遍 = 两个真相）
  const six = code('app/autopsy/SixViewsPanel.tsx');
  const staticIds = (/const STATIC_VIEWS[^=]*=\s*\[([^\]]*)\]/.exec(six)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);
  const diagramIds = [...six.matchAll(/^\s{2}(\w+): \w+Diagram,/gm)].map((m) => m[1]);
  const metaIds = ARCH_VIEWS.map((v) => v.id).filter((id) => id !== 'tech');
  check(
    `六视图：${metaIds.length} 张静态图都有渲染组件（页签表与组件表一致，tech 归画布）`,
    uniq(staticIds).join(',') === uniq(diagramIds).join(',') &&
      metaIds.every((id) => diagramIds.includes(id)) &&
      !staticIds.includes('tech'),
    `缺组件: ${metaIds.filter((id) => !diagramIds.includes(id)).join('、') || '无'}；` +
      `页签表: ${staticIds.join('、') || '无'}；组件表: ${diagramIds.join('、') || '无'}`
  );

  // ⑤′ 侧栏分组折叠（2026-10-12）：菜单默认不再全开，人所在的那个组自动展开
  //
  // 折叠本身是渲染层的事，但它有三个能被静默破坏的地方，逐条钉住：
  //   ① 判据偷偷抄第二份 —— Shell 里自己写 `startsWith('/stack')` 的话，
  //      上面那条「高亮判据只有一份」守的仍然是 isNavActive，折叠这条已经各走各的；
  //   ② 折叠时把地址从菜单数据里删了 —— 十条步骤路由一旦离开 NAV_ROWS，
  //      【13】① 与 ③ 同时失去覆盖，而菜单看起来一切正常；
  //   ③ 移动端被一起折叠 —— 移动端的页一级入口本来就靠这张表，折叠后没入口。
  const stackNavHrefs = [
    ...new Set([
      ...STACK_NAV.map((e) => e.href),
      ...STACK_NAV.flatMap((e) => (e.children ?? []).map((c) => c.href)),
    ]),
  ];
  // 2026-10-17 架构图谱合并棒3：/arch 退役，折叠表里少它一行
  // （它本来就不是 /stack 家族，期望态「收起」不变，只是不再出现在表里）。
  const otherHrefs = ['/', '/rules', '/archify', '/autopsy', '/icons', '/check', '/export'];
  // trailingSlash: true 下 usePathname() 带尾巴，两种写法都得判对
  const openTable = [...stackNavHrefs, ...otherHrefs, '/stack/env/', '/cases/hotspot-cache/'].map((p) => ({
    pathname: p,
    expect: /^\/stack(\/|$)/.test(p),
    got: groupShouldOpen(p, stackNavHrefs),
  }));
  const openBad = openTable.filter((r) => r.expect !== r.got);
  check(
    `侧栏折叠：默认展开判定 ${openTable.length} 个路由各判对（装配台页/步开，其余收起）`,
    openBad.length === 0,
    `判错: ${openBad.map((b) => `${b.pathname} 应${b.expect ? '开' : '收起'}、实${b.got ? '开' : '收起'}`).join('；')}`
  );
  check(
    '侧栏折叠：判定走的是同一份 isNavActive（判据只有一份）',
    !/startsWith\(['"]\/stack/.test(shell) && shell.includes('groupShouldOpen('),
    'Shell 自己写一份前缀判定 → 折叠态与高亮态会分叉（同一次 /archify 点亮 /arch 的事故换个位置重演）'
  );
  check(
    '侧栏折叠：默认态由路由算，不是写死展开',
    /useState<Record<string, boolean>>\(\{\}\)/.test(shell) && shell.includes('aria-expanded'),
    '初始就把所有组标成展开 → "默认全部打开" 的老问题一个字没改；aria-expanded 缺失则读屏听不出这是可展开的'
  );
  check(
    `侧栏折叠：菜单数据一个地址都没少（页 ${STACK_NAV.length} + 步 ${stackNavHrefs.length - STACK_NAV.length} 全在）`,
    /r\.depth >= 1/.test(shell) && shell.includes('children: STACK_NAV') && /NAV_ROWS\.filter/.test(shell),
    '折叠若改成从 NAV_ROWS 里删地址，【13】① 的"入口都指向真实页面"与 ③ 的高亮表同时失去覆盖'
  );
  check(
    '侧栏折叠：移动端不受折叠影响（页一级常显）',
    /\{NAV_ROWS\.map\(/.test(shell) && /\{desktopRows\.map\(/.test(shell),
    '移动端只有一张导航表，折叠一滚就把 4 个装配台页面收没 —— 两块必须各自拿自己的行'
  );

  // ⑤″ 换页即时性（2026-10-12）：先切目录，再给数据
  //
  // 症状（生产静态站实测）：点菜单后 0.37~1.01s 里页面**什么都没动** ——
  // 装配台每次换页都要现算能力审计、导出计划、架构图几何，这一坨阻塞渲染
  // 和侧栏高亮压在同一次提交里。加 Redis 救不了它（数据早就在内存里），
  // 能救的是让浏览器先画一个「算过了」的样子：App Router 的 loading.tsx
  // 是一条 Suspense 边界，边界之外（高亮、页签、标题）立刻提交，边界之内
  // 才等这次现算。实测边界挂上后：URL + 侧栏高亮 + 占位在 11~35ms 落地，
  // 内容随后 54~390ms 补上。
  //
  // 这五条钉的是「边界会被静默拆掉」的四种方式：
  //   ① 有人删了 loading.tsx —— 行为退回「点了没反应」，代码一行没错、类型全过；
  //   ② 边界漏掉某条路由（比如只挂在 /stack 上而步骤路由搬走）—— 那一步又开始卡顿；
  //   ③ 每条路由各写一份骨架 —— 文案与配色会分叉，且【26】的色值唯一出处多一处；
  //   ④ 骨架里写「约 0.5 秒」/塞一个假标题 —— 占位变成预报，假 h1 会让视觉层数错。
  const pending = code('components/RoutePending.tsx');
  const boundary = code('app/stack/loading.tsx');
  const stackSrc = path.resolve(here, '..', 'src');
  const walkFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walkFiles(full) : [full];
    });
  const loadingFiles = walkFiles(path.join(stackSrc, 'app'))
    .filter((f) => /loading\.tsx$/.test(f))
    .map((f) => path.relative(path.join(stackSrc, 'app'), f).replace(/\\/g, '/'));
  const pendingFiles = walkFiles(stackSrc).filter((f) =>
    /\.tsx?$/.test(f) && fs.readFileSync(f, 'utf8').includes('data-route-pending')
  );
  check(
    `换页即时性：装配台 ${stackNavHrefs.length} 条路由（页 4 + 步 10）全在同一条 loading 边界之下`,
    fs.existsSync(path.join(stackSrc, 'app/stack/loading.tsx')) &&
      stackNavHrefs.every((h) => /^\/stack(\/|$)/.test(h)) &&
      boundary.includes('RoutePending') &&
      /<RoutePending/.test(boundary),
    '删掉这条边界或把某条装配台路由搬出 /stack —— 那一步就退回"点下去 1 秒内什么都没发生"，而代码与类型都挑不出错'
  );
  check(
    `换页即时性：边界只圈住现算慢的 /stack（全站 loading.tsx 恰好 ${loadingFiles.length} 份）`,
    loadingFiles.length === 1 && loadingFiles[0] === 'stack/loading.tsx',
    `实到: ${loadingFiles.join('、') || '无'} —— 全局边界会让每个页面首屏都闪一次骨架，规则库/案例页根本不需要`
  );
  check(
    '换页即时性：占位骨架只有一份出处（components/RoutePending.tsx）',
    pendingFiles.length === 1 && /RoutePending\.tsx$/.test(pendingFiles[0]) && pending.includes('data-route-pending'),
    `实到 ${pendingFiles.length} 份：${pendingFiles.map((f) => path.basename(f)).join('、')} —— 每条路由自抄一份骨架，文案与配色必分叉`
  );
  check(
    '换页即时性：骨架住在 components/ 而不是 app/stack/（避开【26】色值扫描范围）',
    fs.existsSync(path.join(stackSrc, 'components/RoutePending.tsx')) &&
      !fs.existsSync(path.join(stackSrc, 'app/stack/RoutePending.tsx')),
    '搬进 stack/ 后【26】会把它当第二处色值出处判红，正确处置往往是把骨架里的类名换成硬编码色 —— 判定被架空'
  );
  // 去注释 + 去 className 之后，剩下的就是「真正会画给人看的字」
  const pendingCopy = pending.replace(/className="[^"]*"/g, '');
  check(
    '换页即时性：占位是诚实的（无数字、无耗时承诺、无假 h1，带 role=status 播报）',
    !/\d/.test(pendingCopy) &&
      !/<h1/.test(pendingCopy) &&
      pending.includes('role="status"') &&
      pending.includes('aria-live="polite"'),
    '写「约 0.5 秒」就是对没测过的环境撒谎；假 h1 会让视觉层的标题计数与读屏顺序一起错；没有 status 则视障用户听不到"还在算"'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【14】项目档案契约 —— 六张图讲的是「哪个项目」，换项目只许换档案
//
// 这一节守的是「泛化」这件事本身。它拦的是三类无声的退化：
//   ① 档案与代码又长回一起 —— 有人图省事把文案写回 arch-views.ts，
//      于是「换项目」变成「改代码」，功能看似还在，能力已经没了；
//   ② 档案里手抄数字 —— 「69 条」写进 JSON，改一次事实源就变成一句自信的错话；
//   ③ 渲染器偷偷读默认档案 —— 切了档案图上还是老项目的数据。
// ═══════════════════════════════════════════════════════════════
/**
 * 源码当数据断言 → 先去注释。
 *
 * 2026-10-01 抓到一个真缺陷：它原本只定义在 `profileChecks()` 内部，
 * 而【26】组（色值唯一出处）在别的块里照着用了同一个名字 —— TS 编译期没报错
 * （别处另有同名局部量），**运行时 ReferenceError 直接把整个 project-check 打断**，
 * 于是那一组 6 条断言从写下到今天一次都没真正跑过。提到模块级，去掉这个隐患。
 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function profileChecks() {
console.log('\n【14】项目档案契约');
{
  const srcFile = (rel: string) => fs.readFileSync(path.resolve(here, '..', 'src', rel), 'utf8');
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  const profilesDir = path.resolve(here, '..', '..', 'arsenal-profiles');
  const files = fs
    .readdirSync(profilesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  check('档案：至少一份内置档案', files.length >= 1, '没有档案六视图只能讲一份故事');

  const docs = files.map((f) => ({
    file: f,
    id: f.replace(/\.json$/, ''),
    doc: JSON.parse(fs.readFileSync(path.join(profilesDir, f), 'utf8')) as Record<string, any>,
  }));

  // ① 文件名 = 档案 id。不一致时按名字找它的人（脚本、?profile=、别人的笔记）会找不到
  const mismatch = docs.filter((d) => d.doc.id !== d.id).map((d) => `${d.file} → id=${String(d.doc.id)}`);
  check('档案：文件名与 id 一致', mismatch.length === 0, mismatch.join('；'));

  // ② 形状 + token 全可解（缺字段、写错 token 都在这拦下）
  const issues = docs.flatMap((d) => profileIssues(d.doc).map((m) => `${d.file}: ${m}`));
  check(`档案：${docs.length} 份形状与 token 全部可解`, issues.length === 0, issues.join('；'));

  // ③ 六视图齐备，且键就是渲染器认识的那六个
  const missingViews = docs.flatMap((d) =>
    ARCH_VIEW_IDS.filter((v) => !d.doc.views?.[v]).map((v) => `${d.file}/${v}`)
  );
  check('档案：六视图齐备', missingViews.length === 0, `缺: ${missingViews.join('、')}`);

  // ④ 能算的数字不许手抄：metric 里出现阿拉伯数字，就必须同时出现 {{token}}
  //    （'未启动'、'工程 zip · prompt · 图谱' 这类没有数字的描述不受约束）
  const handCopy: string[] = [];
  const scanMetrics = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => scanMetrics(v, `${at}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === 'metric' && typeof v === 'string' && /\d/.test(v) && !v.includes('{{')) {
        handCopy.push(`${at}.metric = ${JSON.stringify(v)}`);
      } else {
        scanMetrics(v, `${at}.${k}`);
      }
    }
  };
  docs.forEach((d) => scanMetrics(d.doc, d.id));
  check(
    '档案：metric 里的数字一律来自 token（不许手抄）',
    handCopy.length === 0,
    `手抄的数字会过期还不报错: ${handCopy.join('；')}`
  );

  // ⑤ 文案真的搬出去了：这些句子只许出现在档案里
  const viewsSrc = stripComments(srcFile('lib/arch-views.ts'));
  const leaked = ['规范字典', 'Rule as Data', 'Spring Boot 只读服务', '三种出口链路'].filter((s) =>
    viewsSrc.includes(s)
  );
  check(
    '档案：视图文案已搬出 arch-views.ts',
    leaked.length === 0,
    `文案写回代码 = 换项目要改代码: ${leaked.join('、')}`
  );

  // ⑥ 渲染器不认默认档案：只能从 arch-views 引类型
  // （2026-10-17 棒3：diagrams.tsx 随合并搬进 app/autopsy/，路径连改）
  const diaSrc = stripComments(srcFile('app/autopsy/diagrams.tsx'));
  check(
    '渲染器：五张图只从 arch-views 引类型',
    /import type \{[^}]*ArchViewData[^}]*\} from '@\/lib\/arch-views'/.test(diaSrc) &&
      !/import \{[^}]*\} from '@\/lib\/arch-views'/.test(diaSrc),
    '渲染器读常量的话，切档案要等一次重新构建'
  );

  // ⑦ 页签 ↔ 渲染 ↔ 传参（2026-10-17 棒3：/arch 退役后宿主是 SixViewsPanel）：
  //    当前视图的图必须拿到 `composeArchViews(resolveProfile(当前档案, buildMetrics()))`
  //    算出来的 data，且草稿 / 导入 / 内置三条取数路都在 —— 少一条，
  //    切到那种档案时图上还是旧内容，而两边都不报错。
  const sixSrc = stripComments(srcFile('app/autopsy/SixViewsPanel.tsx'));
  check(
    '六视图：当前图拿到当前档案（data={data}，草稿 / 导入 / 内置三条取数路齐）',
    /<Diagram data=\{data\} \/>/.test(sixSrc) &&
      /composeArchViews\(resolveProfile\(draft\.profile, buildMetrics\(\)\)\)/.test(sixSrc) &&
      /composeArchViews\(resolveProfile\(doc, buildMetrics\(\)\)\)/.test(sixSrc) &&
      /composeArchViews\(getProfile\(profileId\)\)/.test(sixSrc),
    '没传 data 的图会渲染成空；三条取数路少一条，切到那种档案时图还是旧的'
  );

  // ⑧ 档案选择器与页面元信息同源
  check(
    '架构图谱：档案清单来自内置同步结果',
    PROFILE_SUMMARIES.length === PROFILE_ORDER.length && PROFILE_SUMMARIES.every((p) => p.builtin),
    '清单来源不一致时，界面上会列出切不过去的档案'
  );
}


// ═══════════════════════════════════════════════════════════════
// 【15】代码扫描映射表契约 —— 坐标映射到图上哪一位，错了不报错只会少一个节点
// ═══════════════════════════════════════════════════════════════
console.log('\n【15】代码扫描映射表契约');
{
  const repoRoot = path.resolve(here, '..', '..');
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arsenal-scan', 'scan_rules.json'), 'utf8'));
  const gen = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'generated', 'scan_rules.json'), 'utf8'));
  const canvas = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'generated', 'architecture.json'), 'utf8')).canvas;
  const dims = new Set(Object.keys(canvas.dims ?? {}));
  const opts = canvas.options ?? {};

  check('扫描映射表：同步产物与仓库事实源条数一致', gen.rules.length === doc.rules.length,
    `${gen.rules.length} vs ${doc.rules.length}`);

  const badSlot = doc.rules.filter((r: any) => r.dim && (!dims.has(r.dim) || !(r.opt in (opts[r.dim] ?? {}))));
  check('扫描映射表：每条 dim/opt 都在架构画布里真存在', badSlot.length === 0,
    `落不到图上的：${badSlot.slice(0, 3).map((r: any) => `${r.group}:${r.artifact}`).join('、')}`);

  check('扫描映射表：规模达标（≥80 条，且至少 40 条会落节点）',
    doc.rules.length >= 80 && doc.rules.filter((r: any) => r.dim).length >= 40,
    `${doc.rules.length} 条 / ${doc.rules.filter((r: any) => r.dim).length} 条落图`);

  check('扫描映射表：坐标不重复（同一依赖命中两条规则会画出两个节点）',
    new Set(doc.rules.map((r: any) => `${r.kind}|${r.group}|${r.artifact}`)).size === doc.rules.length);

  // 扫描器与映射表是两处代码，规则里写的 icon 必须在图标库里真存在 ——
  // 否则图上是灰方块，而扫描本身一切正常
  const icons = new Set(
    [...fs.readFileSync(path.join(here, '..', 'src', 'lib', 'tech-icons.ts'), 'utf8')
      .matchAll(/^ {2}(?:'([a-z0-9-]+)'|([a-z0-9]+)): \{$/gm)].map((m: any) => m[1] ?? m[2])
  );
  const badIcon = doc.rules.filter((r: any) => r.icon && !icons.has(r.icon));
  check('扫描映射表：icon 全部命中 tech-icons.ts', badIcon.length === 0,
    `对不上的：${badIcon.slice(0, 3).map((r: any) => r.icon).join('、')}`);

  check('扫描引擎：后端 com/arsenal/scan 包齐备（五个子 Scanner + 闸门 + 输入解析）',
    ['ProjectScanner', 'BuildScanner', 'ConfigScanner', 'DeployScanner', 'CodeScanner', 'CiScanner',
      'ScanGuard', 'SourceResolver', 'ScanRulesLoader', 'TechStackResolver', 'ScanException']
      .every((f) => fs.existsSync(path.join(repoRoot, 'arsenal-server', 'src', 'main', 'java', 'com', 'arsenal', 'scan', `${f}.java`)))
  );
}

} // profileChecks

// ═══════════════════════════════════════════════════════════════
// 【16】字段契约一致性 —— 「类型不许对数据撒谎」
//
// 起因（一个活到 690 条断言之外的线上 Bug）：
//   `CaseDef.benchmark` 被声明成**必选**，而 6 个场景里只有 2 个真有这个字段
//   （huge-rowcount-rdb / genomic-sequence-store）。类型一撒谎，tsc 就闭上嘴，
//   `CaseLab` 于是无守卫直读 `kase.benchmark.title`。默认场景恰好有数据，
//   静态预渲染不崩、45 张视觉断言全绿 —— **用户点到第 3 个场景才白屏**。
//
// 690 条断言没抓住它，是因为**没有一条在比「类型声明」与「数据实际」这两方**。
// 本组补的正是这一条，而且**双向**比：
//   · A 方向（类型 → 数据）：声明为必选 ⇒ 每条记录都必须真的有
//   · B 方向（数据 → 类型）：有的记录有、有的没有 ⇒ 类型必须声明为可选
//
// 一个刻意的设计：cookbook 的 `fileCount / highlightCount / ruleCount / lines`
// 在事实源里**一条都没有**（它们由 `sync-content.mjs` 算出后注入同步产物）。
// 这里不假装事实源有它们，而是把它们自动归到「注入字段」，改去对着
// `src/generated/*.json` 断言 —— 「事实源没写」与「注入失败」是两件事，不能混。
// ═══════════════════════════════════════════════════════════════
console.log('\n【16】字段契约一致性（类型 ↔ 事实源）');
{
  const repoRoot = path.resolve(here, '..', '..');
  const srcRoot = path.resolve(here, '..', 'src');
  const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

  /**
   * 读 TS 接口的**顶层**字段与可选性。
   *
   * 解析前先剥注释：注释里写的 `kase.benchmark.title` 之类，不剥就会被当成字段声明。
   * 只取深度 0 的 `名字: 类型;` —— 嵌套对象的内部字段由 `NESTED` 那组单独核。
   */
  const ifaceFields = (rel: string, name: string): { field: string; optional: boolean }[] => {
    const src = fs.readFileSync(path.join(srcRoot, rel), 'utf8');
    const m = new RegExp(`export interface ${name}\\s*\\{`).exec(src);
    if (!m) throw new Error(`【16】找不到 interface ${name}（${rel}）—— 接口改名了要同步改这里`);
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    // 行尾注释也要剥：只剥行首的话，`id: string; // 主键` 后面的 `// 主键`
    // 会被并进下一条声明的文本里，让 `order` 这个字段**从字段表里消失** ——
    // 那样它既不会被断言、也不会报错，只是悄悄少了一组断言（项数对不上才会暴露）
    const body = src
      .slice(start, i)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const out: { field: string; optional: boolean }[] = [];
    let d = 0;
    let buf = '';
    for (const ch of body) {
      if (ch === '{' || ch === '[' || ch === '(') d += 1;
      else if (ch === '}' || ch === ']' || ch === ')') d -= 1;
      if (ch === ';' && d === 0) {
        const mm = /^([A-Za-z_$][\w$]*)(\??)\s*:/.exec((buf + ch).trim());
        if (mm) out.push({ field: mm[1], optional: mm[2] === '?' });
        buf = '';
        continue;
      }
      buf += ch;
    }
    return out;
  };

  const loadLib = (dir: string, key: string) =>
    fs
      .readdirSync(path.join(repoRoot, dir))
      .filter((f) => f.endsWith('.json') && f !== 'meta.json')
      .sort()
      .map((f) => {
        const j = readJson(path.join(repoRoot, dir, f));
        return { id: f.replace(/\.json$/, ''), rec: (j[key] ?? j) as Record<string, unknown> };
      });

  /**
   * 最佳实践库是三层结构（技术 → 场景 → 方案），事实源里一条技术文件里
   * 嵌套着多个场景、每个场景又嵌套着多个方案。这里把它们**摊平**成三类记录
   * 分别对 `Topic` / `Scenario` / `Recipe` 三个接口做双向比对 ——
   * 不摊平的话，嵌套层里少一个字段就没有任何一条断言会去看它。
   */
  const loadCookbook = (level: 'topic' | 'scenario' | 'recipe') =>
    fs
      .readdirSync(path.join(repoRoot, 'arsenal-cookbook'))
      .filter((f) => f.endsWith('.json') && f !== 'meta.json')
      .sort()
      .flatMap((f) => {
        const tid = f.replace(/\.json$/, '');
        const t = readJson(path.join(repoRoot, 'arsenal-cookbook', f)).topic as Record<
          string,
          unknown
        >;
        if (level === 'topic') return [{ id: tid, rec: t }];
        return ((t.scenarios ?? []) as Record<string, unknown>[]).flatMap((s) => {
          const sid = String(s.id);
          if (level === 'scenario') return [{ id: `${tid}/${sid}`, rec: s }];
          return ((s.recipes ?? []) as Record<string, unknown>[]).map((r) => ({
            id: `${tid}/${sid}/${String(r.id)}`,
            rec: r,
          }));
        });
      });

  /**
   * 机理剧本（arsenal-stacks/topology_flows.json，事实源 tools/content/stack_topology_flows.py）
   * 是三层嵌套：维度 id → 选项 id → 形态 id → 剧本。按记录类别摊平后走同一套双向比对 ——
   * 「加一类事实源改四处」里属于字段契约的这一处（播放行为断言在【22】层，
   * 这里只管「类型 ↔ 数据」不许互相撒谎；ⓘ 三层 id 是 Record 索引键，不是字段名）。
   */
  type FlowLevel = 'flow' | 'node' | 'edge' | 'scene' | 'step';
  const flattenFlows = (doc: any, level: FlowLevel): { id: string; rec: Record<string, unknown> }[] => {
    const out: { id: string; rec: Record<string, unknown> }[] = [];
    for (const [dimId, opts] of Object.entries(doc?.flows ?? {})) {
      for (const [optId, modes] of Object.entries(opts as Record<string, any>)) {
        for (const [modeId, flow] of Object.entries(modes as Record<string, any>)) {
          const at = `${dimId}/${optId}/${modeId}`;
          if (level === 'flow') {
            out.push({ id: at, rec: flow });
            continue;
          }
          const pools: Record<Exclude<FlowLevel, 'flow'>, any[]> = {
            node: flow.nodes ?? [],
            edge: flow.edges ?? [],
            scene: [],
            step: [],
          };
          for (const scene of flow.scenes ?? []) {
            pools.scene.push(scene);
            pools.step.push(...(scene.steps ?? []));
          }
          (pools[level] as any[]).forEach((rec, i) => out.push({ id: `${at}#${i}`, rec }));
        }
      }
    }
    return out;
  };
  const loadFlowFact = (level: FlowLevel) =>
    flattenFlows(readJson(path.join(repoRoot, 'arsenal-stacks', 'topology_flows.json')), level);

  type LibSpec = {
    label: string;
    typeFile: string;
    iface: string;
    src: { id: string; rec: Record<string, unknown> }[];
    genFile: string;
    genKey: string;
    /** 同步产物是嵌套的，用它摊平成与 src 对齐的记录数组 */
    genFlat?: (doc: any) => any[];
  };

  const libs: LibSpec[] = [
    {
      label: '场景案例库',
      typeFile: 'lib/case-types.ts',
      iface: 'CaseDef',
      src: loadLib('arsenal-cases', 'case'),
      genFile: 'cases.json',
      genKey: 'cases',
    },
    {
      label: '最佳实践库·方案',
      typeFile: 'lib/content-types.ts',
      iface: 'Recipe',
      src: loadCookbook('recipe'),
      genFile: 'cookbook.json',
      genKey: 'topics',
      genFlat: (doc) =>
        (doc.topics ?? []).flatMap((t: any) =>
          (t.scenarios ?? []).flatMap((s: any) => s.recipes ?? [])
        ),
    },
    {
      label: '最佳实践库·场景',
      typeFile: 'lib/content-types.ts',
      iface: 'Scenario',
      src: loadCookbook('scenario'),
      genFile: 'cookbook.json',
      genKey: 'topics',
      genFlat: (doc) => (doc.topics ?? []).flatMap((t: any) => t.scenarios ?? []),
    },
    {
      label: '最佳实践库·技术',
      typeFile: 'lib/content-types.ts',
      iface: 'Topic',
      src: loadCookbook('topic'),
      genFile: 'cookbook.json',
      genKey: 'topics',
    },
    // 判据契约（W-0，2026-09-27）：三层判据的阈值原本在 build-content.py 与
    // sync-content.mjs **各内联一份**，谁都不查对方。抽成产物里的 `meta.contract` 后，
    // 它就成了被校验的数据 —— 类型漏一个键、产物少一个键，这里当场变红；
    // 而「两边阈值不一致」这一类事故，从「不可能被发现」变成「不可能发生」。
    {
      label: '最佳实践库·元信息',
      typeFile: 'lib/content-types.ts',
      iface: 'CookbookMeta',
      src: [
        {
          id: 'meta',
          rec: readJson(path.join(repoRoot, 'arsenal-cookbook', 'meta.json')) as Record<
            string,
            unknown
          >,
        },
      ],
      genFile: 'cookbook.json',
      genKey: 'meta',
      genFlat: (doc) => [doc.meta],
    },
    // 机理剧本五类记录（部署形态动画化 2026-09-27）：一个剧本一个形态，
    // 节点 / 边 / 场景 / 步骤逐条对类型 —— 剧本数据在播放器里是逐字段直读的，
    // 类型撒谎的后果不会是编译错，而是某一帧静默播错。
    {
      label: '机理剧本·形态',
      typeFile: 'lib/content-types.ts',
      iface: 'TopologyFlow',
      src: loadFlowFact('flow'),
      genFile: 'topology-flows.json',
      genKey: 'flows',
      genFlat: (doc) => flattenFlows(doc, 'flow').map((r) => r.rec),
    },
    {
      label: '机理剧本·节点',
      typeFile: 'lib/content-types.ts',
      iface: 'TopologyFlowNode',
      src: loadFlowFact('node'),
      genFile: 'topology-flows.json',
      genKey: 'flows',
      genFlat: (doc) => flattenFlows(doc, 'node').map((r) => r.rec),
    },
    {
      label: '机理剧本·边',
      typeFile: 'lib/content-types.ts',
      iface: 'TopologyFlowEdge',
      src: loadFlowFact('edge'),
      genFile: 'topology-flows.json',
      genKey: 'flows',
      genFlat: (doc) => flattenFlows(doc, 'edge').map((r) => r.rec),
    },
    {
      label: '机理剧本·场景',
      typeFile: 'lib/content-types.ts',
      iface: 'TopologyFlowScene',
      src: loadFlowFact('scene'),
      genFile: 'topology-flows.json',
      genKey: 'flows',
      genFlat: (doc) => flattenFlows(doc, 'scene').map((r) => r.rec),
    },
    {
      label: '机理剧本·步骤',
      typeFile: 'lib/content-types.ts',
      iface: 'TopologyFlowStep',
      src: loadFlowFact('step'),
      genFile: 'topology-flows.json',
      genKey: 'flows',
      genFlat: (doc) => flattenFlows(doc, 'step').map((r) => r.rec),
    },
  ];

  for (const lib of libs) {
    const fields = ifaceFields(lib.typeFile, lib.iface);
    const declared = new Set(fields.map((f) => f.field));
    const optional = new Set(fields.filter((f) => f.optional).map((f) => f.field));
    const required = fields.filter((f) => !f.optional).map((f) => f.field);
    const genDoc = readJson(path.join(srcRoot, 'generated', lib.genFile));
    const gen = ((lib.genFlat ? lib.genFlat(genDoc) : genDoc[lib.genKey]) ?? []) as Record<
      string,
      unknown
    >[];

    // 样本量为 0 时，后面所有断言都是空跑 —— 先把它自己变成一条断言
    check(
      `${lib.label}：样本量 > 0（事实源 ${lib.src.length} 条 / 同步产物 ${gen.length} 条）`,
      lib.src.length > 0 && gen.length > 0,
      '样本为 0 时下面的断言一条都不会真跑，绿得毫无意义'
    );

    // ── A 方向：类型说必选 ⇒ 数据必须有 ──────────────────────────
    const authored = required.filter((f) => lib.src.some((r) => f in r.rec));
    const injected = required.filter((f) => lib.src.every((r) => !(f in r.rec)));

    for (const f of authored) {
      const miss = lib.src.filter((r) => !(f in r.rec)).map((r) => r.id);
      for (const r of lib.src) {
        check(
          `${lib.label}：${r.id} 有必选字段 ${f}`,
          f in r.rec,
          miss.length ? `同库缺该字段的：${miss.join('、')}` : undefined
        );
      }
    }

    // 事实源里一条都没有、却又被声明成必选的，只可能是「同步脚本注入」——
    // 那就去同步产物里验它真的注入了，而不是对事实源假装它有
    for (const f of injected) {
      for (let i = 0; i < gen.length; i += 1) {
        check(
          `${lib.label}：同步产物第 ${i + 1} 条注入了 ${f}`,
          f in (gen[i] ?? {}),
          `${f} 在事实源里 0/${lib.src.length} 条都没有 —— 它由 sync-content.mjs 注入，注入失败 UI 就会读到 undefined`
        );
      }
    }

    // ── B 方向：数据里「有的有、有的没有」⇒ 类型必须说可选 ──────────
    const hetero = [...declared].filter((f) => {
      const n = lib.src.filter((r) => f in r.rec).length;
      return n > 0 && n < lib.src.length;
    });
    const liar = hetero.filter((f) => !optional.has(f));
    check(
      `${lib.label}：异构字段一律声明为可选`,
      liar.length === 0,
      `类型说必选、数据却只有部分记录有（无守卫读它必崩）：${liar.join('、') || '无'}` +
        `；本库异构字段：${hetero.map((f) => `${f} ${lib.src.filter((r) => f in r.rec).length}/${lib.src.length}`).join('、') || '无'}`
    );
  }

  // ── A5：嵌套类型的必选字段（按「库 × 嵌套类型 × 记录」聚合）─────────
  // 一个 slice 缺 `sql` 与一个 case 缺 `benchmark` 是同一类事故，只是藏得更深
  const NESTED: { lib: string; iface: string; pick: (r: any) => any[] }[] = [
    { lib: '场景案例库', iface: 'CaseSlice', pick: (r) => r.slices ?? [] },
    { lib: '场景案例库', iface: 'SliceDecision', pick: (r) => (r.slices ?? []).map((s: any) => s.decision) },
    {
      lib: '场景案例库',
      iface: 'SliceHighlight',
      pick: (r) => (r.slices ?? []).flatMap((s: any) => s.highlights ?? []),
    },
    { lib: '场景案例库', iface: 'Driver', pick: (r) => r.drivers ?? [] },
    {
      lib: '场景案例库',
      iface: 'DriverLevel',
      pick: (r) => (r.drivers ?? []).flatMap((d: any) => d.levels ?? []),
    },
    { lib: '场景案例库', iface: 'ArchNode', pick: (r) => r.architecture?.nodes ?? [] },
    { lib: '场景案例库', iface: 'ArchLink', pick: (r) => r.architecture?.links ?? [] },
    { lib: '最佳实践库·方案', iface: 'FlowStep', pick: (r) => r.flow ?? [] },
    { lib: '最佳实践库·方案', iface: 'FeatureFile', pick: (r) => r.files ?? [] },
    {
      lib: '最佳实践库·方案',
      iface: 'Highlight',
      pick: (r) => (r.files ?? []).flatMap((f: any) => f.highlights ?? []),
    },
    // 参考出处挂在**技术**层（方案不重复抄一遍出处），所以从技术记录上取
    { lib: '最佳实践库·技术', iface: 'FeatureReference', pick: (r) => r.references ?? [] },
    // 判据契约是 meta 上的一个嵌套对象，14 个键缺一个就等于那条判据**从来没生效过**
    // （sync 读到 undefined 不会报错，只会把门槛静默当成 0 条）
    {
      lib: '最佳实践库·元信息',
      iface: 'CookbookContract',
      pick: (r) => [r.contract],
    },
    {
      lib: '最佳实践库·技术',
      iface: 'PlaygroundDemo',
      pick: (r) => (r.scenarios ?? []).flatMap((s: any) => (s.recipes ?? []).flatMap((p: any) => p.playground ?? [])),
    },
  ];

  for (const spec of NESTED) {
    const lib = libs.find((l) => l.label === spec.lib)!;
    const req = ifaceFields(lib.typeFile, spec.iface)
      .filter((f) => !f.optional)
      .map((f) => f.field);
    for (const r of lib.src) {
      const raw: any[] = spec.pick(r.rec) ?? [];
      const items = raw.filter(Boolean);
      const bad: string[] = [];
      // 先报「取出来就是空的」：`SliceDecision` 这类是从父对象里 map 出来的，
      // 少了它父对象仍在，光数 items 会静默少一个 —— 只有全没了才会被 `items.length > 0` 抓到
      if (raw.length !== items.length) bad.push(`${raw.length - items.length} 个实例本身为 null/undefined`);
      items.forEach((it: any, i: number) => {
        const miss = req.filter((f) => !(f in it));
        if (miss.length) bad.push(`#${i} 缺 ${miss.join('/')}`);
      });
      check(
        `${spec.lib}：${r.id} 的 ${items.length} 个 ${spec.iface} 必选字段齐全`,
        items.length > 0 && bad.length === 0,
        bad.length
          ? bad.slice(0, 3).join('；')
          : '样本为 0 —— 这条断言空跑了，等于没有断言'
      );
    }
  }
}

// 【17】装配台视觉契约 —— P1 第一组（S1-1 / S1-2 / S1-3 / S1-6 / S1-7）
//
// 为什么放在「结构与导出」层而不是视觉层：这五条改的是**呈现的规则**
// （三档宽度、选中态、常驻移除、字号四档、空态引导），视觉层测的是
// 渲染出来的几何（溢出 / 对比度 / 越界），两边互补 —— 但「规则」本身
// 只能对着源码断言，渲染出来的截图说不清「宽度为什么是 208」。
// 全部是「源码即数据」：解析前不剥注释的教训见【16】（这里直接用字符串包含，
// 不做结构化解析，误伤面更小；代价是改写法时要同步改这里）。
// ═══════════════════════════════════════════════════════════════
console.log('\n【17】装配台视觉契约（/stack P1 第一组）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const stackCss = readRel('src/app/globals.css');
  const slotSrc = readRel('src/app/stack/SlotBlock.tsx');

  // P0 四页（2026-09-29）：StackComposer.tsx 已拆成 `useStackChannel`（状态通道）+
  // `StackDeck`（常驻结论条）+ `StackSoftware`（台面）+ `StackDelivery`（产物区）。
  // 原来「对着一个源码文件」的断言改为读**这一组文件的合集** ——
  // 判据一条没放松，只是被搜索的文件从 1 个变成 4 个：拆页不该让断言静默变空跑。
  const STACK_SPLIT = [
    'src/app/stack/useStackChannel.ts',
    'src/app/stack/StackDeck.tsx',
    'src/app/stack/StackSoftware.tsx',
    'src/app/stack/StackDelivery.tsx',
  ];
  const missingSplit = STACK_SPLIT.filter((f) => !fs.existsSync(path.join(webRoot, f)));
  check(
    `装配台拆页：${STACK_SPLIT.length} 个承载文件都在（P0 四页后断言读它们的合集）`,
    missingSplit.length === 0,
    `缺失：${missingSplit.join(' ') || '无'}`
  );
  const composerSrc = STACK_SPLIT.map(readRel).join('\n');

  // ── S1-1 台面化 ──────────────────────────────────────────────
  const STACK_VARS = ['--stack-bench', '--stack-bench-grid', '--stack-part', '--stack-part-hi'];
  const rootBlock = /:root\s*\{[^}]*\}/.exec(stackCss)?.[0] ?? '';
  const missingVars = STACK_VARS.filter((v) => !rootBlock.includes(v));
  check(
    'S1-1 globals.css :root 声明装配台四个变量',
    missingVars.length === 0,
    `缺失：${missingVars.join(' ')}（:root 块 ${rootBlock ? '已读到' : '没读到'}）`
  );

  const benchRule = /\.stack-bench\s*\{[^}]*\}/.exec(stackCss)?.[0] ?? '';
  check(
    'S1-1 .stack-bench 是 34px 网格且真的在读变量（变量不许无读取方）',
    benchRule.includes('34px 34px') &&
      benchRule.includes('var(--stack-bench)') &&
      benchRule.includes('var(--stack-bench-grid)'),
    `规则体：${benchRule.slice(0, 90)}`
  );
  // 词边界判据：子串包含会让 `stack-benchBROKEN` / `stack-bench-grid` 这类变形也蒙混过关
  // （2026-09-25 第 1 棒 R-2 实测：改成 stack-benchBROKEN 时 747 项全绿）。
  // 所以这里先把 className 里的类名全部切成 token，再要求存在**恰好等于** stack-bench 的那一个。
  const classTokens = [
    ...composerSrc.matchAll(/className=(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g),
  ].flatMap((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim().split(/\s+/));
  const benchTokens = classTokens.filter((c) => c === 'stack-bench');
  check(
    `S1-1 装配区容器套上台面（stack-bench 是完整类名，实测 ${benchTokens.length} 处）`,
    benchTokens.length > 0,
    '装配台承载文件（P0 拆页后是四个容器而非 StackComposer）的 className 里没有独立的 stack-bench 类名（只比子串会让拼错的变形也判过）'
  );
  check(
    'S1-1 泳道表头是左侧固定标签列（writing-mode vertical-rl）',
    /writingMode:\s*'vertical-rl'/.test(composerSrc)
  );
  check(
    'S1-1 泳道之间的连线是 SVG（WireLayer，S1-4 迁出），不再用 ↓ 字符',
    /export function WireLayer\(/.test(readRel('src/app/stack/WireLayer.tsx')) &&
      !composerSrc.includes('↓'),
    composerSrc.includes('↓') ? '装配台承载文件源码里还有 ↓ 字符' : ''
  );

  // ── S1-2 权重分级 ────────────────────────────────────────────
  const widthOf = (k: string) => new RegExp(`\\b${k}:\\s*(\\d+)`).exec(slotSrc)?.[1];
  check(
    'S1-2 SLOT_WIDTH 三档 = 核心 208 / 常规 172 / 旁路 148',
    widthOf('core') === '208' && widthOf('regular') === '172' && widthOf('bypass') === '148',
    `core=${widthOf('core')} regular=${widthOf('regular')} bypass=${widthOf('bypass')}`
  );
  check(
    'S1-2 卡片宽度来自 weight 档位，不再写死 w-[172px]',
    /width:\s*SLOT_WIDTH\[weight\]/.test(slotSrc) && !slotSrc.includes('w-[172px]')
  );

  // 三档分布从**数据**推出来，跟源码里的判定互为印证：
  // 若 pipelines 出现了不存在的泳道键，三档会静默塌成一档 regular。
  const laneSlots: Record<string, string[]> = {};
  for (const [id, node] of Object.entries<any>(arch.nodes)) {
    (laneSlots[node.lane] ??= []).push(id);
  }
  const orphanPipelines = Object.keys(arch.pipelines).filter((k) => !(k in laneSlots));
  check(
    'S1-2 pipelines 的键都是真实泳道（否则三档分布静默塌成 regular）',
    orphanPipelines.length === 0,
    `幽灵泳道：${orphanPipelines.join(' ')}`
  );
  const dist = { core: 0, bypass: 0, regular: 0 };
  for (const [laneId, ids] of Object.entries(laneSlots)) {
    const order: string[] = arch.pipelines[laneId] ?? [];
    for (const id of ids) {
      if (order.includes(id)) dist.core += 1;
      else if (order.length > 0) dist.bypass += 1;
      else dist.regular += 1;
    }
  }
  check(
    'S1-2 三档分布与数据一致（核心 3 / 旁路 1 / 常规 29 —— pipelines 数据变了要同步改这里）',
    dist.core === 3 && dist.bypass === 1 && dist.regular === 29,
    `实测 ${JSON.stringify(dist)}，维度数 ${dimensions.length}`
  );
  const weightTernary = /const weight: SlotWeight =([\s\S]*?);/.exec(composerSrc)?.[1] ?? '';
  check(
    'S1-2 权重判定按方案 §2.4（在链路 → core / 有链路不在链路 → bypass / 其余 regular）',
    /inPipeline\s*\?\s*'core'/.test(weightTernary) &&
      /pipelineOrder\.length > 0\s*\?\s*'bypass'/.test(weightTernary) &&
      /'regular'/.test(weightTernary),
    `判定体没匹配上：${weightTernary.replace(/\s+/g, ' ').slice(0, 90)}`
  );
  const danglingPipeline = Object.entries(arch.pipelines).flatMap(([k, v]) =>
    (v as string[]).filter((id) => !(laneSlots[k] ?? []).includes(id))
  );
  check(
    'S1-2 链路引用的槽位都属于该泳道（引用错位会被当成旁路件）',
    danglingPipeline.length === 0,
    `越界引用：${danglingPipeline.join(' ')}`
  );

  // ── S1-3 焦点与深度 ──────────────────────────────────────────
  check(
    'S1-3 ④ 卡片无 hover 显隐交互（触屏没有 hover；09-28 八反馈起卡片整体只读）',
    !slotSrc.includes('group-hover:flex')
  );
  check(
    'S1-3 ④ 卡片无第二修改入口：不引用 onClear / onSwap（09-28 八反馈：改零件去归属步骤）',
    !slotSrc.includes('onClear') && !slotSrc.includes('onSwap')
  );
  check(
    'S1-3 ④ 卡片无伪装按钮（role=button 的 span 已随只读化退场，卡片本体是唯一按钮形态）',
    !slotSrc.includes('role="button"')
  );
  check(
    'S1-3 选中态 = 黄铜 ring + shadow-lift + --stack-part-hi（L4）',
    // 2026-10-01：色值收编后这里不再是裸 `#D9A441`，而是 `${TONE.warn.color}` ——
    // 判据改成「ring 的色值取自 TONE.warn」而不是「等于某个字面量」，
    // 既跟上了收编，又仍然拦得住「选中态改成了别的颜色」。
    /0 0 0 1px \$\{TONE\.warn\.color\}/.test(slotSrc) &&
      slotSrc.includes('0 12px 32px -16px rgba(0,0,0,0.9)') &&
      slotSrc.includes('var(--stack-part-hi)')
  );
  check(
    'S1-3 同层降噪 0.96（dimmed）与未用件 0.72 并存且互斥',
    /unused \? 0\.72 : dimmed \? 0\.96 : 1/.test(slotSrc)
  );

  // ── S1-6 字号与密度 ──────────────────────────────────────────
  const fontPx = [...slotSrc.matchAll(/text-\[(\d+)px\]/g)].map((m) => m[1]);
  const fontSet = [...new Set(fontPx)].sort((a, b) => Number(a) - Number(b));
  check(
    'S1-6 卡内不再出现 9px 字号（消灭 9px 连排）',
    !fontSet.includes('9'),
    `出现过的字号档：${fontSet.join('/')}`
  );
  check(
    'S1-6 卡内字号收成 4 档（meta 10 / body 11 / strong 12 / title 14）',
    fontSet.join('/') === '10/11/12/14',
    `实际：${fontSet.join('/')}`
  );
  const missingLeading = ['leading-[15px]', 'leading-[16px]', 'leading-[18px]'].filter(
    (l) => !slotSrc.includes(l)
  );
  check(
    'S1-6 三档行高（15 / 16 / 18）都在卡内出现',
    missingLeading.length === 0,
    `缺失：${missingLeading.join(' ')}`
  );

  // ── S1-7 空态与引导 ──────────────────────────────────────────
  check(
    'S1-7 空态引导两行（「装 X →」+「装了有什么用」，后者用 line-clamp-2 收口）',
    slotSrc.includes('装 ') && slotSrc.includes('line-clamp-2')
  );
  check(
    'S1-7 引导覆盖「选了 none 那一档」（isNone 也算未使用，否则默认态 33 格全是 filled、引导一行都不出）',
    /isNone \|\| \(!picked && !node\.required\)/.test(slotSrc)
  );
  check(
    'S1-7 引导文案来自事实源（defaultOption / options），不许在组件里编文案',
    /dim\.defaultOption/.test(composerSrc) && /dim\.options\.find/.test(composerSrc)
  );

  // ── 配色守卫：语义色仍然只有 TONE 五色 + 既有文本 token ──────
  // 只扫本棒新写/重写的两处：SlotBlock 全文件 + WireLayer 全文件
  // （S1-4 起连线职责从 StackComposer 的 LaneWire 迁到独立文件 WireLayer.tsx；
  //   2026-09-29 P0 拆页后原 StackComposer 已不存在，这里说的「不扫」变成了天然成立）。
  const wireSrc = readRel('src/app/stack/WireLayer.tsx');
  check(
    '配色守卫：WireLayer.tsx 已读到且含连线（定位不到的话下面的色值扫描就是空跑）',
    // 2026-10-01：结构线色收编进 INK.treeLine，文件里不再有 `#3C4D45` 字面量 ——
    // 判据改成「结构线取自 INK.treeLine」，仍拦得住「这个文件读空了 / 连线被删了」。
    wireSrc.includes('INK.treeLine') && wireSrc.length > 800
  );
  const ALLOWED_HEX = new Set([
    '#E5484D', '#D9A441', '#7FA650', '#5E6E67', '#6E8FA8',
    '#E8F0EC', '#80918A', '#93A39C', '#3C4D45',
  ]);
  const hexScan = `${slotSrc}\n${wireSrc}`;
  const strayHex = [
    ...new Set([...hexScan.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase())),
  ].filter((h) => !ALLOWED_HEX.has(h));
  check(
    '配色守卫：装配台两个文件没有新增第二配色谱系',
    strayHex.length === 0,
    `不在允许清单里的色值：${strayHex.join(' ')}`
  );
}

// ═══════════════════════════════════════════════════════════════
// 【18】装配台 P1 第二组 —— S1-4 连线可视化 / S1-5 结论条闭环仪表 / S2-7 去重收编
//
// 三条都是「呈现规则」级改动，继续沿用【17】的口径：源码即数据，
// 字符串包含 + 正则提取，解析前不剥注释（误伤面小；改写法要同步这里）。
// S2-7 的「页签 id ↔ 页签条 ↔ 渲染分支」三处一致性本身由【13】④ 守着，
// 这里钉的是「砍掉」这个事实本身（防回潮：把 tree/arch/risk 加回去必须改这里）。
// ═══════════════════════════════════════════════════════════════
console.log('\n【18】装配台 P1 第二组（S1-4 / S1-5 / S2-7）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const wireSrc = readRel('src/app/stack/WireLayer.tsx');
  const ringSrc = readRel('src/app/stack/ProgressRing.tsx');
  const deckSrc = readRel('src/app/stack/DeliveryDeck.tsx');

  // 同【17】：P0 四页后被搜索的是四个承载文件的合集（判据不变，只是换了承载文件）
  const STACK_SPLIT_18 = [
    'src/app/stack/useStackChannel.ts',
    'src/app/stack/StackDeck.tsx',
    'src/app/stack/StackSoftware.tsx',
    'src/app/stack/StackDelivery.tsx',
  ];
  const missingSplit18 = STACK_SPLIT_18.filter((f) => !fs.existsSync(path.join(webRoot, f)));
  check(
    `装配台拆页：${STACK_SPLIT_18.length} 个承载文件都在（【18】断点阵 / 连线 / 草稿 / 分享）`,
    missingSplit18.length === 0,
    `缺失：${missingSplit18.join(' ') || '无'}`
  );
  const composerSrc = STACK_SPLIT_18.map(readRel).join('\n');
  const globalsCss = readRel('src/app/globals.css');

  // ── S1-4 连线可视化 ──────────────────────────────────────────
  check(
    'S1-4 WireLayer.tsx 同时导出泳道间连线与槽内箭头（两类连线一份出处）',
    /export function WireLayer\(/.test(wireSrc) && /export function SlotWire\(/.test(wireSrc)
  );
  check(
    'S1-4 字符箭头已清零：链路箭头由 SVG 出（旧的 mono → span 模式不再出现）',
    !/text-\[13px\][^>]*>\s*→/.test(composerSrc.replace(/\/\*[\s\S]*?\*\//g, '')) &&
      composerSrc.includes('<SlotWire flowOn={flowOn} />') &&
      composerSrc.includes('<WireLayer flowOn={flowOn} />'),
    '槽内箭头没有走 SlotWire，或旧的字符箭头还在'
  );
  check(
    'S1-4 开关默认关（flowOn useState(false)），动效是放大镜不是常驻装饰',
    /useState<\s*boolean\s*>\(false\)|setFlowOn\]\s*=\s*useState\(false\)/.test(
      composerSrc.replace(/\s+/g, ' ')
    ) || /const \[flowOn, setFlowOn\] = useState\(false\)/.test(composerSrc),
    'flowOn 初值不是 false —— 违反「关闭时零动效」的默认'
  );
  check(
    'S1-4 关闭时零动效：连线类名是三元（flowOn ? 流动类 : undefined），不是常挂',
    /className=\{flowOn \? 'stack-wire-flow' : undefined\}/.test(wireSrc) &&
      (wireSrc.match(/className=\{flowOn \? 'stack-wire-flow' : undefined\}/g)?.length ?? 0) === 2,
    '两条连线（WireLayer/SlotWire）都必须在关闭时挂 undefined'
  );
  check(
    'S1-4 流动类定义在 globals.css 且尊重 prefers-reduced-motion',
    globalsCss.includes('.stack-wire-flow') &&
      /@keyframes stack-wire-dash/.test(globalsCss) &&
      /prefers-reduced-motion:\s*reduce/.test(globalsCss)
  );
  check(
    'S1-4 开关按钮可访问（aria-pressed 反映状态）',
    /aria-pressed=\{flowOn\}/.test(composerSrc)
  );

  // ── S1-5 结论条闭环仪表 ──────────────────────────────────────
  check(
    'S1-5 ProgressRing 只有一份定义，两处消费方都是 import（抄一份必漂移）',
    /export default function ProgressRing\(/.test(ringSrc) &&
      /import ProgressRing from '\.\/ProgressRing'/.test(deckSrc) &&
      /import ProgressRing from '\.\/ProgressRing'/.test(composerSrc) &&
      !deckSrc.includes('function ProgressRing(') &&
      !composerSrc.includes('function ProgressRing(')
  );
  check(
    'S1-5 结论条挂了必选覆盖率环（ratio 来自 audit.stats，不另算一遍）',
    /<ProgressRing[\s\S]{0,200}?ratio=\{audit\.stats\.requiredTotal > 0 \? audit\.stats\.requiredFilled \/ audit\.stats\.requiredTotal : 0\}/.test(
      composerSrc
    ),
    '结论条没有 ProgressRing，或 ratio 不是从 audit.stats 算的'
  );
  // 点阵格数从数据核：点阵 map 的必须是 dimensions（33），不是写死的数组。
  const dimsLen = dimensions.length;
  const dotMap = /dimensions\.map\(\(d\) =>/.test(composerSrc);
  check(
    `S1-5 点阵一格一维：map 的是 dimensions（当前 ${dimsLen} 维），不是写死的数组`,
    dotMap && dimsLen === 33,
    dotMap ? `维度数 ${dimsLen} ≠ 33，若数据真变了要同步改这条` : '点阵没有 map dimensions'
  );
  check(
    'S1-5 点阵可点击直达（onSelect → focusDim：setActiveDim + benchRef 滚动）',
    /onSelect=\{focusDim\}/.test(composerSrc) &&
      /function focusDim\(dimId: string\) \{[\s\S]{0,200}?setActiveDim\(dimId\)[\s\S]{0,200}?benchRef\.current\?\.scrollIntoView/.test(composerSrc) &&
      /ref=\{benchRef\}/.test(composerSrc),
    '点阵点了没反应，或台面容器没挂 benchRef'
  );
  check(
    'S1-5 点阵颜色与零件卡同一份语义（bad/conflict→warn/filled→ok/其余 idle）',
    /st === 'missing-required' \? TONE\.bad/.test(composerSrc) &&
      /st === 'conflict' \? TONE\.warn/.test(composerSrc) &&
      /st === 'filled' \? TONE\.ok/.test(composerSrc) &&
      /TONE\.idle/.test(composerSrc),
    '点阵另写了一套颜色语义 —— 违反「TONE 五色含义不许复用/另立」'
  );

  // ── S2-7 去重收编 ────────────────────────────────────────────
  const cutTabs = ['tree', 'arch', 'risk'];
  const idUnion = [
    ...(/type TabId\s*=([\s\S]*?);/.exec(composerSrc)?.[1] ?? '').matchAll(/'([a-z]+)'/g),
  ].map((m) => m[1]);
  check(
    'S2-7 TabId 已不含 tree / arch / risk（回潮 = 与右栏双份渲染，先改这里）',
    cutTabs.every((t) => !idUnion.includes(t)),
    `仍在 TabId 里: ${cutTabs.filter((t) => idUnion.includes(t)).join('、')}`
  );
  const branches = [...composerSrc.matchAll(/tab === '([a-z]+)'/g)].map((m) => m[1]);
  check(
    'S2-7 被砍页签的渲染分支同步清零（id 与分支必须一起动，【13】④ 守一致性）',
    cutTabs.every((t) => !branches.includes(t)),
    `仍有渲染分支: ${cutTabs.filter((t) => branches.includes(t)).join('、')}`
  );
  check(
    'S2-7 被砍分支的专属组件不再被装配台引用（ProjectTree / ArchDiagram / TechArch / GapCard / RiskSection）',
    ['ProjectTree', 'ArchDiagram', 'TechArch', 'GapCard', 'RiskSection'].every(
      (n) => !new RegExp(`[<]${n}[\\s/]`).test(composerSrc)
    ),
    '砍了页签但组件还挂在别处 —— 检查是否留了半截渲染'
  );
  check(
    'S2-7 右栏入口存在：产物区有指向交付预览的按钮（砍页签不砍入口）',
    composerSrc.includes('目录树 / 架构图 / 隐患单 → 右侧交付预览') &&
      /setDeckFocus\('arch'\)/.test(composerSrc)
  );
  check(
    'S2-7 DeliveryDeck 有 focusTab 消费点（setTab + onFocusConsumed 回报，否则同值第二次不生效）',
    /if \(!focusTab\) return;/.test(deckSrc) &&
      /setTab\(focusTab\)/.test(deckSrc) &&
      /onFocusConsumed\?\.\(\)/.test(deckSrc)
  );

  // ── S1-6 收尾 / S2-8 V2-12 / S2-3 撤销重做（09-24 白天补） ────
  // P0 四页：StackComposer 拆成 useStackChannel / StackDeck / StackSoftware /
  // StackEnv / StackRun / StackDelivery，加上新拆出的 StepRail / JourneyBar。
  // 清单跟着一起换 —— 留着旧文件名等于「扫一个不存在的文件」，断言会变空跑。
  const STACK_9PX = [
    'SlotBlock',
    'Inspector',
    'DeliveryDeck',
    'GapCard',
    'TopologyPicker',
    'useStackChannel',
    'StackDeck',
    'StackSoftware',
    'StackEnv',
    'StackRun',
    'StackDelivery',
    'StepRail',
    'JourneyBar',
  ];
  const stackFiles = STACK_9PX.map((n) =>
    readRel(`src/app/stack/${n === 'useStackChannel' ? 'useStackChannel.ts' : `${n}.tsx`}`)
  );
  const with9px = STACK_9PX.filter((_, i) => stackFiles[i].includes('text-[9px]'));
  check(
    `S1-6 装配台 ${STACK_9PX.length} 个活跃组件全部无 9px 字号（9px 连排清零；孤儿文件 ProjectTree 不在扫描内）`,
    with9px.length === 0,
    `仍有 9px：${with9px.join(' ')}`
  );

  // ── P0 拆页防回归：四个容器必须各渲染**自己那一段** ──────────
  //
  // 2026-09-29 P0 实测事故的指纹：四张装配台截图**字节完全相同**。
  // 根因是 useStackChannel 里那条「恢复出来的 step 不在本页 → replace 回属主页」
  // 的 effect 把 `step` 写进了依赖数组 —— 于是进入任意装配台页都会先被一条
  // `router.replace` 拽回 `/stack/`，四页渲染成同一个页面。
  //
  // 这层把关只能靠源码文本（渲染结果要浏览器，那是 visual 层的事），判据是两条：
  //   ① 四个容器各自只用自己那几步的步骤组件（不能都挂同一批）；
  //   ② 每个容器都写死了自己的页面 id（useStackChannel('env') 这类）。
  // 判据刻意不碰 wizard / 步骤组件本身 —— 拆页是信息架构改动，引擎该零改动。
  const PAGE_OWNERS: { page: string; file: string; steps: string[] }[] = [
    // ④ 分层装配不做成独立步骤组件 —— 它就是「台面」本身（StackSoftware 里的 renderBench），
    // 所以 Software 页只认前三个 imports，第四个槽位留给台面渲染函数。
    { page: 'software', file: 'StackSoftware.tsx', steps: ['ProjectStep', 'BaseStep', 'ThemeStep', 'renderBench'] },
    { page: 'env', file: 'StackEnv.tsx', steps: ['FrontendStep', 'EnvStep', 'ModulesStep'] },
    { page: 'run', file: 'StackRun.tsx', steps: ['DeliverRunStep', 'TopologyStep'] },
    { page: 'delivery', file: 'StackDelivery.tsx', steps: ['DeliveryStep'] },
  ];
  const pageSrc = Object.fromEntries(
    PAGE_OWNERS.map((p) => [p.page, readRel(`src/app/stack/${p.file}`)])
  );
  const wrongSeg = PAGE_OWNERS.filter((p) => {
    const src = pageSrc[p.page];
    // ① 自己那几步必须都在
    if (!p.steps.every((s) => src.includes(s))) return true;
    // ② 别人的步骤组件一律不许出现（出现即说明两页渲染同一段）
    const foreign = PAGE_OWNERS.filter((q) => q.page !== p.page).flatMap((q) => q.steps);
    return foreign.some((s) => new RegExp(`\\b${s}\\b`).test(src));
  });
  check(
    'P0 拆页：四个容器各渲染自己那一段（外段的步骤组件一个都不许出现）',
    wrongSeg.length === 0,
    wrongSeg.map((p) => `${p.file} 的步骤归属不对`).join('；')
  );
  // 2026-10-05 步骤路由：容器多了第二个参数 pinnedStep（步骤页把那一步钉死），
  // 声明判据改按**前缀**匹配 —— `useStackChannel('env'` 就算声明过页面 id。
  const selfDecl = PAGE_OWNERS.filter((p) => !pageSrc[p.page].includes(`useStackChannel('${p.page}'`));
  check(
    'P0 拆页：每个容器都声明自己的页面 id（useStackChannel(\'<page>\')）',
    selfDecl.length === 0,
    selfDecl.map((p) => `${p.file} 没声明 page id`).join('；')
  );
  check(
    'P0 拆页：页面归属裁决只许在挂载时做一次（step 不许进 useStackChannel 恢复 effect 的依赖数组）',
    // 依赖数组里出现裸 `step` = 页内换步会被顶回属主页（实测会把 URL 拽回 /stack/）。
    // 判据抓的是「setStep(pageSpec.steps[0]) 那行之后紧跟着的依赖数组」——
    // 用 [\s\S] 跨行而不是 \s（\s 不含跨段注释里的换行会漏判）。
    /setStep\(pageSpec\.steps\[0\]\);[\s\S]*?\}, \[hydrated, pageSpec\.id, pageSpec\.steps\]\);/.test(
      readRel('src/app/stack/useStackChannel.ts')
    ),
    'useStackChannel 的页面归属 effect 依赖数组被改过 —— 一旦把 step 放回去，四个装配台页会渲染成同一页'
  );

  const topologySrc = readRel('src/lib/topology.ts');
  check(
    'S2-8 V2-12 副本数来源可辨：paramIsSet 导出 + Capacity 带 replicasSource（未设显示 —，不许拿哨兵 0 当输入值）',
    /export function paramIsSet\(/.test(topologySrc) &&
      /replicasSource: 'override' \| 'topology'/.test(topologySrc) &&
      deckSrc.includes('capacity.replicasSource') &&
      deckSrc.includes('paramIsSet(meta')
  );

  const historySrc = readRel('src/app/stack/history.ts');
  check(
    'S2-3 撤销 / 重做：history.ts 快照栈（20 上限 + 同 tag 合并）且 StackComposer 全部写入口挂 record',
    /const LIMIT = 20;/.test(historySrc) &&
      /top\.tag === tag/.test(historySrc) &&
      /useStackHistory\(\)/.test(composerSrc) &&
      (composerSrc.match(/hist\.record\(/g) ?? []).length >= 6 &&
      /e\.shiftKey \|\| e\.key\.toLowerCase\(\) === 'y'/.test(composerSrc)
  );

  // ── S2-1 就地换件 / S2-2 一键补齐 / S2-4 搜索与筛选（09-24 白天补） ──
  const inspectorSrc = readRel('src/app/stack/Inspector.tsx');
  const slotSrc = readRel('src/app/stack/SlotBlock.tsx');
  check(
    'S2-1 选项行只有一份渲染：OptionList 模板全 Inspector 独一份（④ 只读后台面不再引用）',
    /export function OptionList\(/.test(inspectorSrc) &&
      /<OptionList[\s\S]{0,80}?onPick=\{onPick\}/.test(inspectorSrc) &&
      !/<OptionList/.test(slotSrc) &&
      (inspectorSrc.match(/divide-y divide-line/g) ?? []).length === 1,
    '选项行模板不止一份（divide-y ul 全 Inspector 应只出现一次，就在 OptionList 里）'
  );
  check(
    'S2-1 ④ 无就地换件浮层（portal 菜单已随只读化退场 —— 一个决定只有一个入口）',
    !slotSrc.includes('createPortal') && !slotSrc.includes('data-swap-menu')
  );
  check(
    'S2-1 推荐排序出自事实源：recommendedOrder 读 defaultOption，「不用 X」档垫底（退出项不是候选）',
    /function recommendedOrder\(/.test(inspectorSrc) &&
      /defaultOption/.test(inspectorSrc) &&
      /o\.id !== 'none'/.test(inspectorSrc)
  );
  check(
    'S2-2 一键补齐只补必选未装（slotStates missing-required），且走 hist.record 一步可撤销',
    /function fillRecommended\(/.test(composerSrc) &&
      /function fillRecommended\([\s\S]{0,600}?=== 'missing-required'/.test(composerSrc) &&
      (composerSrc.match(/hist\.record\(/g)?.length ?? 0) >= 7,
    '补齐入口不见了，或补齐没走历史栈（撤不回 = 假补齐）'
  );
  check(
    'S2-2 补齐入口挂在缺必需模块时（missingRequired > 0），补了哪几块有回执且可撤销',
    composerSrc.includes('data-fill-cta') &&
      /missingRequired > 0 && \(/.test(composerSrc) &&
      composerSrc.includes('data-fill-note') &&
      composerSrc.includes('已按推荐补齐') &&
      composerSrc.includes('撤销补齐')
  );
  check(
    'S2-4 搜索框 + 三档筛选存在且互斥单选（aria-pressed，再点一次取消）',
    composerSrc.includes('data-dim-search') &&
      composerSrc.includes("data-filter-chip={key}") &&
      ['unpicked|未选', 'hazard|有隐患', 'required|必选'].every((pair) => {
        const [k, label] = pair.split('|');
        return composerSrc.includes(`'${k}', '${label}'`);
      }) &&
      /setDimFilter\(on \? null : key\)/.test(composerSrc)
  );
  check(
    'S2-4 命中集合 map dimensions 全集（搜索词 ∩ 筛选档），卡片用 muted 聚光灯而非移除',
    /for \(const d of dimensions\)/.test(composerSrc) &&
      /muted=\{visibleDims !== null && !visibleDims\.has\(dimId\)\}/.test(composerSrc) &&
      /opacity: muted \? 0\.28/.test(slotSrc),
    '筛选不生效，或把卡片从台面上搬走了（搬家丢泳道空间记忆）'
  );

  // ── S2-5 键盘导航 / S2-6 方案对比（09-24 中午补） ──
  const draftsSrc = readRel('src/app/stack/drafts.ts');
  check(
    'S2-5 Esc 分层关闭：草稿面板 > 台面聚焦（换件菜单已随 ④ 只读化退场，无需让位）',
    /if \(e\.key !== 'Escape'\) return;/.test(composerSrc) &&
      /setShowDraftSave\(false\)/.test(composerSrc) &&
      /if \(activeDim\) setActiveDim\(null\);/.test(composerSrc)
  );
  check(
    'S2-5 泳道可导航：section 挂 data-lane，卡片 ←→ 沿 button[data-dim] 移动焦点',
    /data-lane=\{lane\.id\}/.test(composerSrc) &&
      /closest\('\[data-lane\]'\)/.test(slotSrc) &&
      /querySelectorAll<HTMLButtonElement>\('button\[data-dim\]'\)/.test(slotSrc) &&
      /'ArrowLeft' && e\.key !== 'ArrowRight'/.test(slotSrc)
  );
  check(
    'S2-6 草稿键读写同源：drafts.ts 唯一持有 arsenal-stack-drafts-v1，StackComposer 消费 loadDrafts/saveDrafts（只写不读的键不许存在）',
    draftsSrc.includes("STACK_DRAFTS_KEY = 'arsenal-stack-drafts-v1'") &&
      (draftsSrc.match(/localStorage/g) ?? []).length >= 2 &&
      // 花名册不写死：C-4-2 加了 `draftsKey` 之后整行 import 变了，
      // 写死一份名字列表 = 每次多导出一个 helper 这条就假红。
      /import \{[^}]*\bloadDrafts, saveDrafts\b[^}]*\} from '\.\/drafts';/.test(composerSrc) &&
      /loadDrafts\(\)/.test(composerSrc) &&
      /saveDrafts\(/.test(composerSrc)
  );
  check(
    'S2-6 草稿结构完整：picks + meta + baseId 一起存（缺一对比就是错话），上限 DRAFTS_LIMIT 生效',
    /picks: StackPicks;/.test(draftsSrc) &&
      /meta: StackPicksMeta;/.test(draftsSrc) &&
      /baseId: string;/.test(draftsSrc) &&
      /list\.slice\(0, DRAFTS_LIMIT\)/.test(draftsSrc)
  );
  check(
    'S2-6 保存写的是当前三通道快照（picks/meta/baseId）且差异条逐维度出自 picks 对比、chip 可直达',
    /savedAt: new Date\(\)\.toISOString\(\),[\s\S]{0,120}?picks,\s*[\s\S]{0,60}?meta,\s*[\s\S]{0,60}?baseId,/.test(
      composerSrc
    ) &&
      composerSrc.includes('data-diff-bar') &&
      composerSrc.includes('data-diff-chip') &&
      /\(picks\[d\.id\] \?\? ''\) !== \(diffDraft\.picks\[d\.id\] \?\? ''\)/.test(composerSrc) &&
      /onClick=\{\(\) => focusDim\(d\.id\)\}/.test(composerSrc),
    '差异条没从 picks 实时算，或 chip 点了不跳'
  );

  // ── S3-3 分享链接 / S3-4 规则联动（09-24 中午补） ──
  const picksStoreSrc = readRel('src/lib/picks-store.ts');
  const ruleHitsSrc = readRel('src/lib/rule-hits.ts');
  const ruleHitsTsx = readRel('src/app/stack/RuleHits.tsx');
  check(
    'S3-3 分享编码/解码同源：picks-store 唯一持有 #s= 格式，TextEncoder 过 UTF-8 再 base64url',
    /export function encodeSharePayload\(/.test(picksStoreSrc) &&
      /export function parseShareHash\(/.test(picksStoreSrc) &&
      picksStoreSrc.includes('new TextEncoder().encode(JSON.stringify(payload))') &&
      picksStoreSrc.includes("replace(/\\+/g, '-')") &&
      picksStoreSrc.includes("replace(/\\//g, '_')") &&
      picksStoreSrc.includes('#s=')
  );
  check(
    'S3-3 hash 优先于 localStorage 且是一次性引子：恢复后 replaceState 抹掉 hash，刷新回到新当前态',
    /const shared = parseShareHash\(window\.location\.hash\);/.test(composerSrc) &&
      /parseShareHash[\s\S]{0,600}?loadSnapshot\(\)/.test(composerSrc) &&
      /history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/.test(
        composerSrc
      ),
    'hash 恢复不是一次性（刷新会永远回到过期分享态），或没有优先于 localStorage'
  );
  check(
    'S3-3 分享按钮接剪贴板、失败降级为可全选复制的输入行（静默失败 = 假按钮）',
    /data-share-cta/.test(composerSrc) &&
      /navigator\.clipboard\?\.writeText/.test(composerSrc) &&
      /\.catch\(\(\) => setShareUrl\(url\)\)/.test(composerSrc) &&
      /data-share-fallback/.test(composerSrc)
  );
  check(
    'S3-4 映射有据：java-17↔java 17+、spring-boot-3↔line 3.x（精确排除 Quarkus3/Boot4）、maven/git 骨架恒含、mysql 同名、jdbc 非空数据库',
    ruleHitsSrc.includes("base.java === '17+'") &&
      ruleHitsSrc.includes("base.line.startsWith('3.')") &&
      ruleHitsSrc.includes("keys.add('mysql')") &&
      /db !== 'none'/.test(ruleHitsSrc) &&
      /GENERAL_STACK_KEYS = \['java-17', 'spring-boot-3', 'maven', 'git'\]/.test(ruleHitsSrc)
  );
  check(
    'S3-4 id 必须真实存在：命中的规则全部来自 @/lib/rules 的 rules（appliesTo 过滤），无写死 id 数组',
    /import \{ rules \} from '@\/lib\/rules';/.test(ruleHitsSrc) &&
      /appliesTo\?\.stack \?\? \[\]\).some\(/.test(ruleHitsSrc) &&
      !/['"](?:SKEL|DATA|TEST|SVC|API)-[A-Z]+-\d+['"]/.test(ruleHitsSrc) &&
      /import \{ rules \} from '@\/lib\/rules';/.test(ruleHitsTsx)
  );
  check(
    'S3-4 装配台消费：Inspector 结论区挂 RuleHits（选型层逐条 + 基底层收一行），链接指向 /rules/<id>',
    /<RuleHits picks=\{picks\} baseId=\{baseId\} \/>/.test(inspectorSrc) &&
      /data-rule-hit/.test(ruleHitsTsx) &&
      /href=\{`\/rules\/\$\{r\.id\}`\}/.test(ruleHitsTsx) &&
      /href="\/rules"/.test(ruleHitsTsx)
  );
}

// ═══════════════════════════════════════════════════════════════
// 【19】案例代码自证 —— 「我的范例符合我的规范」必须是一句被验证过的话
//
// 案例库存在的全部理由是「让 AI 照抄我的写法」。可它自己的代码从来没有喂进
// 自己的规则引擎过 —— 也就是说，「照抄我的范例 = 合规」这句承诺此前没人验过。
//
// 本组把 `src/lib/cookbook-lint.ts` 的自证结果钉成契约，四条底线：
//   · 样本必须非空 —— 0 个 recipe 时「零违规」是空话，不是结论
//   · MUST/NEVER 违规必须为 0 —— 这是闸门
//   · 可执行 / 未判两档的条数必须来自**规则集实测**，不许写死常数
//     （写死的「35 条 / 34 条」在规则涨到 40 条那天就成了假话）
//   · 闸门必须自证有效 —— 内置一段反例喂进去，必须真报出违规
//
// ⚠ 硬约定：`recipes[].files[].code` 只放 good 版，bad 示例写进 pitfalls。
// 引擎是文本层正则判定，分不出「演示错写法」和「这是错写法」，混进 bad 就是误报。
// ═══════════════════════════════════════════════════════════════
console.log('\n【19】案例代码自证（recipes[].files 过自己的引擎）');
{
  const webRoot = path.resolve(here, '..');
  const repoRoot = path.resolve(here, '..', '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

  const activeRules = rules.filter((r) => r.status === 'active');
  const expectedExecutable = activeRules.filter((r) => r.check?.regex?.pattern).length;
  const expectedSkipped = activeRules.length - expectedExecutable;

  const results = recipeLocations.map((loc) => ({
    id: `${loc.topic.id}/${loc.scenario.id}/${loc.recipe.id}`,
    res: lintFeatureFiles(loc.recipe.files),
  }));
  const filesTotal = results.reduce((n, x) => n + x.res.fileCount, 0);
  const blockingAll = results.flatMap((x) => x.res.blocking);

  // ① 样本口径 —— 空跑通过的断言等于摆设，先把样本量钉住
  check(
    `自证样本非空且与案例库统计一致（${results.length} 套方案 / ${filesTotal} 个文件）`,
    results.length > 0 &&
      filesTotal > 0 &&
      results.length === cookbookStats.recipes &&
      filesTotal === cookbookStats.files,
    `方案 ${results.length} vs stats.recipes ${cookbookStats.recipes}；文件 ${filesTotal} vs stats.files ${cookbookStats.files}`
  );

  // ② 闸门本体
  check(
    '全部方案的代码零 MUST/NEVER 违规',
    blockingAll.length === 0,
    blockingAll.map((v) => `${v.ruleId} @ ${v.file}:${v.line}`).join('；') || '（无）'
  );

  // ③ 可执行条数取自规则集实测
  const badExec = results.filter((x) => x.res.executableRules !== expectedExecutable);
  check(
    `可执行规则数取自规则集实测（当前 ${expectedExecutable} 条），不是写死的常数`,
    expectedExecutable > 0 && badExec.length === 0,
    badExec.map((x) => `${x.id}=${x.res.executableRules}`).join('；')
  );

  // ④ 未判如实披露，且分层计数自洽
  const badSkip = results.filter(
    (x) =>
      x.res.skippedRules !== expectedSkipped ||
      x.res.skippedByLayer.reduce((n, s) => n + s.count, 0) !== expectedSkipped
  );
  check(
    `未判规则数如实披露（当前 ${expectedSkipped} 条 = 规则池 − 可执行），分层计数与之自洽`,
    expectedSkipped > 0 && badSkip.length === 0,
    badSkip.map((x) => `${x.id}=${x.res.skippedRules}`).join('；')
  );

  // ⑤ 三档守恒 + 无规则缺陷（规则自己的正则编译不过 ≠ 能力边界）
  const badSum = results.filter(
    (x) => x.res.executableRules + x.res.skippedRules + x.res.brokenRules !== x.res.rulePool
  );
  check(
    '三档守恒：可执行 + 未判 + 规则缺陷 = 规则池，且规则缺陷为 0',
    badSum.length === 0 && results.every((x) => x.res.brokenRules === 0),
    badSum
      .map(
        (x) =>
          `${x.id}: ${x.res.executableRules}+${x.res.skippedRules}+${x.res.brokenRules}≠${x.res.rulePool}`
      )
      .join('；')
  );

  // ⑥ 未判清单逐条可核
  const badSkipItem = results.flatMap((x) =>
    x.res.skipped.filter((s) => {
      const r = rules.find((y) => y.id === s.ruleId);
      return !r || !!r.check?.regex?.pattern;
    })
  );
  check(
    '未判清单逐条可核：ruleId 在规则集里存在，且确实没有 check.regex',
    badSkipItem.length === 0,
    badSkipItem.map((s) => s.ruleId).join('、') || '（无）'
  );

  // ⑦ 闸门自证 —— 内置反例，不需要人工注入就能证明它不是摆设
  const probe = lintFeatureFiles([
    {
      path: 'src/main/java/com/example/vt/BadProbe.java',
      code: [
        'package com.example.vt;',
        'class BadProbe {',
        '  void go() {',
        '    new Thread(() -> {}).start();',
        '    Executors.newCachedThreadPool();',
        '  }',
        '}',
        '',
      ].join('\n'),
    },
  ]);
  const probeIds = new Set(probe.blocking.map((v) => v.ruleId));
  check(
    '闸门自证：喂一段 new Thread(...) + Executors.newCachedThreadPool() 必须报出 CONC-POOL-001 / 002',
    probe.blocking.length > 0 && probeIds.has('CONC-POOL-001') && probeIds.has('CONC-POOL-002'),
    `实测命中 ${probe.blocking.length} 条：${[...probeIds].join('、') || '（无）'}`
  );

  // ⑧ 徽标数字必须算出来 —— 文案里写死计数是第二天就会变假的话
  const badgeSrc = readRel('src/components/BlueprintSelfCheck.tsx');
  const lintSrc = readRel('src/lib/cookbook-lint.ts');
  // 先剥注释再扫：注释里会**点名**这些反模式（「不许写死条数」「不许渲染 durationMs」），
  // 不剥的话守卫会把自己写的说明当成违规，红得莫名其妙（实测踩过一次）。
  const badgeCode = badgeSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const hardcodedCopy = [...badgeCode.matchAll(/[「（(]?\s*(\d{1,3})\s*条/g)].map((m) => m[1]);
  check(
    '徽标数字取自 lint 结果：文案里没有写死的条数，数字全部来自 selfCheckFeature',
    hardcodedCopy.length === 0 &&
      /lintFeatureFiles\(feature\.files\)/.test(badgeCode) &&
      /selfCheckSummary\(r\)/.test(badgeCode) &&
      // 引擎耗时两次跑不一样，渲染进文案会让整页水合报 #425（实测踩过）
      !badgeCode.includes('durationMs') &&
      // 比数值不够，还要比**出处**：把当前正确的 34 直接写死，数值断言依然全绿
      // （实测过：`skippedRules: 34` 时 ④⑤ 都是绿的）。所以这里钉住「不许是常数」。
      !/(?:executableRules|skippedRules|rulePool):\s*\d+/.test(
        lintSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      ),
    `文案里出现写死条数：${hardcodedCopy.join('、') || '（无）'}；或把非确定性的 durationMs 渲染进了 DOM；或 cookbook-lint 里存在写死的常数`
  );

  // ⑨ 页面真挂上 + 展开区契约
  const viewSrc = readRel('src/components/BlueprintView.tsx');
  check(
    '方案页真挂自证徽标，且展开区四类数据齐全（开关 / 详情 / 命中行 / 未判清单）',
    /import BlueprintSelfCheck from '@\/components\/BlueprintSelfCheck';/.test(viewSrc) &&
      /<BlueprintSelfCheck feature=\{feature\} \/>/.test(viewSrc) &&
      /data-selfcheck-toggle/.test(badgeSrc) &&
      /data-selfcheck-detail/.test(badgeSrc) &&
      /data-selfcheck-hit/.test(badgeSrc) &&
      /data-selfcheck-skipped/.test(badgeSrc),
    'BlueprintView 没渲染徽标，或展开区缺数据锚点'
  );

  // ⑩ 引擎按路径匹配 —— 喂 id 会让带 targetGlob 的规则静默不适用
  check(
    '喂引擎的是 file.path（不是 id）：否则带 targetGlob 的规则全部静默不适用',
    /name:\s*f\.path/.test(lintSrc),
    'cookbook-lint.ts 没有把 path 作为 SourceFile.name'
  );

  // ⑪ 硬约定三处登记：生成方 / 消费方 / 长期记忆
  const buildSrc = fs.readFileSync(path.join(repoRoot, 'tools', 'build-content.py'), 'utf8');
  const memSrc = fs.readFileSync(
    path.join(repoRoot, '.workbuddy', 'memory', 'MEMORY.md'),
    'utf8'
  );
  check(
    '「files[].code 只放 good 版」硬约定三处登记（cookbook-lint / build_cookbook / MEMORY）',
    lintSrc.includes('只放 good 版') &&
      buildSrc.includes('只放 good 版') &&
      memSrc.includes('只放 good 版'),
    '生成方或长期记忆里没写这条约定 —— 半年后坏示例混进 files 就没人拦得住'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【20】规则 ↔ 案例双向互链 —— 「建好却没接线」是最贵的那类资产闲置
//
// 体检 B-3 的原文是：`recipesByRule` 在 cookbook.ts 里已经按规则 ID 建好反向索引，
// 但 `rules/[id]` 页面**零引用** —— 用户从规则页看不到那条规则在哪个真实案例里落地了。
// 索引存在不等于接上了，所以下面四条分别守：
//   · 页面真的 import 了它并且真的渲染了（不是另一个半成品）
//   · 没有关联案例时不渲染空壳（空壳会让「8/69 条规则有案例」看起来像 bug）
//   · 链路双向可达，且不产生死 id / 死路由
//   · 覆盖口径与实际数据自洽（不许索引漏项、也不许把总数写死）
// ═══════════════════════════════════════════════════════════════
console.log('\n【20】规则 ↔ 案例双向互链（C-3）');
{
  const webRoot = path.resolve(here, '..');
  const ruleDetailSrc = fs.readFileSync(
    path.join(webRoot, 'src', 'app', 'rules', '[id]', 'page.tsx'),
    'utf8'
  );
  const viewSrc = fs.readFileSync(
    path.join(webRoot, 'src', 'components', 'BlueprintView.tsx'),
    'utf8'
  );
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const ruleDetailCode = strip(ruleDetailSrc);

  // ① 反向索引真的接上了（源码契约 + 页面锚点）
  check(
    '规则详情页真的接了 recipesByRule 反向索引（不是另一个半成品）',
    /import \{ recipesByRule \} from '@\/lib\/cookbook';/.test(ruleDetailSrc) &&
      /recipesByRule\.get\(rule\.id\)/.test(ruleDetailCode) &&
      /哪些案例在用这条规则/.test(ruleDetailSrc) &&
      /data-related-recipes=\{relatedRecipes\.length\}/.test(ruleDetailCode),
    'rules/[id]/page.tsx 没有消费 recipesByRule —— 索引会一直是死的'
  );

  // ② 没有关联案例时不许渲染空壳
  check(
    '无关联案例时不渲染空壳区块（空壳会把「只有 N 条规则有案例」伪装成 bug）',
    /\{relatedRecipes\.length > 0 && \(/.test(ruleDetailCode),
    '区块是无条件渲染的 —— 没有关联案例的规则页会露出一个空标题'
  );

  // ③ 链路双向可达且不产生死链接
  const ruleIds = new Set(rules.map((r) => r.id));
  const badRuleId = recipeLocations.flatMap((loc) =>
    loc.recipe.relatedRules.filter((rid) => !ruleIds.has(rid)).map((rid) => `${loc.recipe.id}:${rid}`)
  );
  const routeKeys = new Set(
    recipeLocations.map(({ topic, scenario }) => `${topic.id}/${scenario.id}`)
  );
  const deadHref = [...recipesByRule.entries()].flatMap(([rid, locs]) =>
    locs
      .map(({ topic, scenario }) => `${topic.id}/${scenario.id}`)
      .filter((k) => !routeKeys.has(k))
      .map((k) => `${rid}→${k}`)
  );
  check(
    `互链双向可达且无死链接（${recipesByRule.size} 条规则有案例 / ${routeKeys.size} 个可达场景路由）`,
    badRuleId.length === 0 &&
      deadHref.length === 0 &&
      // 反向：案例页的规则 chip 必须指回真实规则路由
      /href=\{`\/rules\/\$\{rid\}`\}/.test(viewSrc) &&
      /getRule\(rid\)/.test(viewSrc),
    `规则侧死 id：${badRuleId.join('、') || '（无）'}；案例侧死路由：${deadHref.join('、') || '（无）'}`
  );

  // ④ 覆盖口径自洽：索引不漏项（含重复计数），且确实非空
  const mentions = recipeLocations.reduce((n, loc) => n + loc.recipe.relatedRules.length, 0);
  const indexed = [...recipesByRule.values()].reduce((n, v) => n + v.length, 0);
  check(
    `覆盖口径自洽：recipesByRule 覆盖 ${recipesByRule.size} 条规则 / ${indexed} 次引用，与事实源侧 ${mentions} 次逐条对齐`,
    recipesByRule.size > 0 &&
      indexed === mentions &&
      recipesByRule.size === allRelatedRules.length &&
      allRelatedRules.every((rid) => ruleIds.has(rid)),
    `索引 ${indexed} vs 事实源 ${mentions}；去重后 ${recipesByRule.size} vs allRelatedRules ${allRelatedRules.length}`
  );
}

// ═══════════════════════════════════════════════════════════════
// 【21】README 里的「项数口径」—— 散文里顺手写下的数字也得有人守
//
// `verify:meta` 守住了四处派生数字：档案 verifyChain / README 总数句 / README 分项表 / 本身。
// 但 README **正文散文中**顺手写下的项数没人管 —— 2026-09-26 终检实测：
// 「所以 1024 的口径不受影响」这句话从 09-25 一路错到 09-26，期间九层一直全绿。
// 一套十层全绿，却挡不住正文里一句话过期。这次把这类写法一次性钉住。
// ═══════════════════════════════════════════════════════════════
console.log('\n【21】README 正文里的项数口径');
{
  const repoRoot = path.resolve(here, '..', '..');
  const readmeSrc = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const lines = readmeSrc.split('\n');

  // 抓三位数以上、紧跟「项」或「口径」的写法；刻意不抓两位数（「刻意未跑 2 项」不是这个口径），
  // 也不抓代码块（README 里贴过一段历史运行快照，块首已写明「数字随环境变，不是规格」）。
  // ⚠️ 排除「选项」——「33 维度 / 127 选项」里的 127 是选型台选项数，不是验证项数（误伤实测）。
  const hits: { line: number; n: string; text: string }[] = [];
  let inFence = false;
  lines.forEach((text, i) => {
    if (/^\s*```/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const m of text.matchAll(/(?<![\d])(\d{3,4})\s*项(?!选)/g))
      hits.push({ line: i + 1, n: m[1], text: text.trim().slice(0, 60) });
    for (const m of text.matchAll(/(?<![\d])(\d{3,4})\s*的口径/g))
      hits.push({ line: i + 1, n: m[1], text: text.trim().slice(0, 60) });
  });
  // 「刻意未跑 2 项」所在的行不算（它是另一种口径，且字数不到三位已经天然排除了）
  const strays = hits.filter((h) => h.n !== String(VERIFY_TOTAL));
  check(
    `README 正文里的项数口径全部等于实测总数 ${VERIFY_TOTAL}（扫到 ${hits.length} 处）`,
    hits.length > 0 && strays.length === 0,
    strays.map((h) => `第 ${h.line} 行写着 ${h.n}：${h.text}`).join('；') || '（无）'
  );

  // ── 两位数口径（2026-09-27 补）────────────────────────────────────────
  // 09-26 有 4 处张数漂移（45→42→…）就是趁「两位数没人守」溜过去的。这里收窄守卫：
  // 只守**当前规模**的断言（「N 张截图矩阵 / N 张矩阵 / 跑 N 张」「N 路由」），
  // 数据源是 visual/shoot.mjs 的 EXPECTED 声明值（96 张 = 32 路由 × 3 视口，
  // visual 层拿它对账、shoot.mjs 截图数对不上它自己会红）——README 跟它对齐即闭环。
  // 刻意不守（真值不在机器源里，硬守只会教会人写假数字）：
  //   · 历史叙事：「由 45 张同步为 42 张」是过去式，不是当前规模的断言；
  //   · 判读进度：「判读了 34 张 / 其余 17 张 / 新增 9 张」，真值在 findings.md 散文里；
  //   · 位图张数等其它「N 张」：数据源各异，不在这个收窄口径里。
  const shootSrc = fs.readFileSync(path.join(repoRoot, 'arsenal-web', 'visual', 'shoot.mjs'), 'utf8');
  const expectedM = shootSrc.match(/\burls:\s*(\d+),\s*\n\s*shots:\s*(\d+),/);
  check(
    'shoot.mjs 的 EXPECTED 声明可解析（urls/shots 两个常数都在）',
    expectedM !== null,
    '从 visual/shoot.mjs 解析不出 `urls: N, shots: N,` —— 守卫读不到数据源，先修这处锚点'
  );
  if (expectedM !== null) {
    const expUrls = Number(expectedM[1]);
    const expShots = Number(expectedM[2]);
    const matrixHits: { line: number; unit: string; n: string; text: string }[] = [];
    let inFence2 = false;
    lines.forEach((text, i) => {
      if (/^\s*```/.test(text)) {
        inFence2 = !inFence2;
        return;
      }
      if (inFence2) return;
      for (const m of text.matchAll(/(?<![\d])(\d{1,2})\s*张(?=截图矩阵|矩阵)/g))
        matrixHits.push({ line: i + 1, unit: '张(矩阵规模)', n: m[1], text: text.trim().slice(0, 60) });
      for (const m of text.matchAll(/(?<![\d])跑\s*(\d{1,2})\s*张(?![\d])/g))
        matrixHits.push({ line: i + 1, unit: '张(实跑)', n: m[1], text: text.trim().slice(0, 60) });
      for (const m of text.matchAll(/(?<![\d])(\d{1,2})\s*个?路由(?![\d])/g))
        matrixHits.push({ line: i + 1, unit: '路由', n: m[1], text: text.trim().slice(0, 60) });
    });
    const matrixStrays = matrixHits.filter(
      (h) => h.n !== String(h.unit === '路由' ? expUrls : expShots)
    );
    check(
      `README 两位数矩阵口径（张 / 路由）全部等于 shoot.mjs 的 EXPECTED（${expShots} 张 = ${expUrls} 路由，扫到 ${matrixHits.length} 处）`,
      matrixHits.length > 0 && matrixStrays.length === 0,
      matrixStrays.map((h) => `第 ${h.line} 行 ${h.unit}写着 ${h.n}：${h.text}`).join('；') || '（无）'
    );
  }

  // ── 规则集 README 的数字口径（2026-09-27 补）──────────────────────────
  // 同一类事故换了个文件重演：`arsenal-rules/README.md` 的「规则总数」长期写着
  // **62**（实 69）、「建议级」写着 **12**（实 18）。它不在【21】原先的扫描口径里
  // （那是「N 项」与「N 的口径」，这里是「规则总数 / 建议级」），所以一路全绿。
  // 规则集是这个仓库的立身之本，它自己的 README 说不清自己有多少条规则，
  // 比验证项数写错更不该发生 —— 这里把四个数全部钉到 `rules.json` 实测值上。
  const srcRoot = path.resolve(here, '..', 'src');
  const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));
  const rulesDoc = readJson(path.join(srcRoot, 'generated', 'rules.json'));
  const rulesArr = (Array.isArray(rulesDoc) ? rulesDoc : rulesDoc?.rules ?? []) as {
    severity?: string;
  }[];
  const sev = (s: string) => rulesArr.filter((r) => r.severity === s).length;
  const mustN = sev('MUST');
  const neverN = sev('NEVER');
  const shouldN = sev('SHOULD');
  const mayN = sev('MAY');

  const rulesReadme = fs.readFileSync(path.join(repoRoot, 'arsenal-rules', 'README.md'), 'utf8');
  const tableNum = (label: string): number | null => {
    const m = new RegExp(`\\|\\s*${label}\\s*\\|\\s*(\\d+)`).exec(rulesReadme);
    return m ? Number(m[1]) : null;
  };
  for (const [label, actual] of [
    ['规则总数', rulesArr.length],
    ['强制级（MUST \\+ NEVER）', mustN + neverN],
    ['建议级（SHOULD）', shouldN],
    ['可选级（MAY）', mayN],
  ] as [string, number][]) {
    const written = tableNum(label);
    check(
      `arsenal-rules/README.md 的「${label.replace('\\', '')}」等于实测 ${actual}`,
      written !== null && written === actual,
      written === null
        ? `在 arsenal-rules/README.md 的表格里找不到「${label}」这一行 —— 行名改了要同步改这里`
        : `表里写着 ${written}，rules.json 实测 ${actual}（MUST ${mustN} / NEVER ${neverN} / SHOULD ${shouldN} / MAY ${mayN}）`
    );
  }
}

// 【23】判据单一来源（W-0 · 共享判据）—— 「同一套规矩写了两份」是最难发现的那一类错
//
// 案例库三层判据的阈值原本在 `tools/build-content.py` 的 `build_cookbook()` 与
// `arsenal-web/scripts/sync-content.mjs` 里**各内联一份**。它们是同一套规矩的两个副本，
// 却没有任何东西保证它们相等 —— 改了构建期忘了同步期，结果是「构建放行、同步拦截」，
// 报错还指向一份读者根本没看过的代码。案例库要扩到 9 条主线（A-1），判据一定会被
// 反复调整：双写的代价不是今天多改一处，而是**将来每一次调整都可能只改一处**。
//
// 抽成产物里的 `meta.contract` 之后，判据成了**被校验的数据**。本组守三件事：
//   ① 阈值真的只有一份定义处，且三处（定义 / 事实源产物 / 同步产物）逐键一致；
//   ② 两边都真的在读它，谁都不许再内联数字；
//   ③ 契约缺键必须失败，绝不允许静默回落到某个默认值（回落 = 又造了一份副本）。
//
// ⚠️ 刻意**不**去 grep 裸的 `30` / `2` / `3`（太宽泛，必然误伤无关代码）——
//    扫的是「契约键名 + 比较运算符 + 数字字面量」落在**同一行**的形态，
//    并且把扫描范围收窄到 cookbook 那一节 / `build_cookbook()` 那一个函数。
console.log('\n【23】判据单一来源（W-0 · 共享判据）');
{
  const repoRoot = path.resolve(here, '..', '..');
  const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));

  // ── ① 契约的定义处：tools/content/cookbook_contract.py ──────────────
  const pyPath = path.join(repoRoot, 'tools', 'content', 'cookbook_contract.py');
  const pySrc = fs.existsSync(pyPath) ? fs.readFileSync(pyPath, 'utf8') : '';
  const pyBlock = /COOKBOOK_CONTRACT\s*=\s*\{([\s\S]*?)\n\}/.exec(pySrc);
  check(
    '判据契约的定义处可读（tools/content/cookbook_contract.py 的 COOKBOOK_CONTRACT）',
    pyBlock !== null,
    '抠不出 COOKBOOK_CONTRACT —— 契约改名或换了写法，下面几条断言会全部空跑'
  );

  const pyContract: Record<string, number> = {};
  if (pyBlock) {
    for (const m of pyBlock[1].matchAll(/'([A-Za-z]+)'\s*:\s*(\d+)\s*,/g)) {
      pyContract[m[1]] = Number(m[2]);
    }
  }
  const KEYS = Object.keys(pyContract);

  const metaContract =
    (readJson(path.join(repoRoot, 'arsenal-cookbook', 'meta.json')).contract ?? {}) as Record<
      string,
      number
    >;
  const genContract =
    (readJson(path.join(path.resolve(here, '..'), 'src', 'generated', 'cookbook.json'))?.meta
      ?.contract ?? {}) as Record<string, number>;

  // ── ② 三处逐键一致：定义 / 事实源产物 / 同步产物 ────────────────────
  // 「忘了重跑 sync」在这里是可见的：产物比定义少一个键，就会当场对不上。
  const union = Array.from(
    new Set([...KEYS, ...Object.keys(metaContract), ...Object.keys(genContract)])
  ).sort();
  const drifted = union.filter(
    (k) => pyContract[k] !== metaContract[k] || metaContract[k] !== genContract[k]
  );
  check(
    `判据三处逐键一致（Python 定义 / meta.json / 同步产物，共 ${union.length} 键）`,
    union.length >= 14 && drifted.length === 0,
    drifted.length
      ? drifted
          .map((k) => `${k}: 定义=${pyContract[k]} meta=${metaContract[k]} 同步=${genContract[k]}`)
          .join('；')
      : `只扫到 ${union.length} 键，少于约定的 14 —— 契约漏键或没重跑 sync`
  );

  const badVals = union.filter((k) => !Number.isInteger(metaContract[k]) || metaContract[k] < 1);
  check(
    '判据值全为正整数（0 或负数 = 门槛形同虚设，却不会报错）',
    badVals.length === 0,
    badVals.map((k) => `${k}=${String(metaContract[k])}`).join('；') || '（无）'
  );

  // ── ③ 两边都不许再内联阈值 ──────────────────────────────────────────
  const syncPath = path.join(repoRoot, 'arsenal-web', 'scripts', 'sync-content.mjs');
  const syncSrc = fs.readFileSync(syncPath, 'utf8');
  const secA = syncSrc.indexOf('// ── ① 最佳实践案例库');
  const secB = syncSrc.indexOf('// ── ② 技术选型');
  check(
    'sync-content.mjs 的 cookbook 段可定位（① / ② 两个分节标记都在）',
    secA >= 0 && secB > secA,
    '找不到 ① 最佳实践案例库 … ② 技术选型 的分节标记 —— 扫描范围失效，下一条会空跑'
  );
  const syncSec = secA >= 0 && secB > secA ? syncSrc.slice(secA, secB) : '';

  const syncInline: string[] = [];
  syncSec.split('\n').forEach((line, i) => {
    if (!/\.\s*length\s*<\s*\d/.test(line)) return;
    const hit = KEYS.find((k) => new RegExp(`\\b${k}\\b`).test(line));
    if (hit) syncInline.push(`第 ${i + 1} 行 ${hit}：${line.trim().slice(0, 60)}`);
  });
  check(
    'sync-content.mjs 的 cookbook 段不再内联判据阈值（全部读 meta.contract）',
    syncSec.length > 0 && syncInline.length === 0,
    syncInline.join('；') || '（无）'
  );

  const pyBuild = fs.readFileSync(path.join(repoRoot, 'tools', 'build-content.py'), 'utf8');
  const fnStart = pyBuild.indexOf('def build_cookbook():');
  const fnEnd = pyBuild.indexOf('\ndef build_', fnStart + 1);
  const fnBody = fnStart >= 0 ? pyBuild.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : '';
  check(
    'build_cookbook() 的函数体可定位（作用域收窄，避免误伤文件里其它数字）',
    fnBody.length > 0,
    '在 tools/build-content.py 里定位不到 build_cookbook() —— 下一条会空跑'
  );

  const pyInline: string[] = [];
  fnBody.split('\n').forEach((line, i) => {
    if (!/<\s*\d/.test(line)) return;
    const hit = KEYS.find((k) => line.includes(`get('${k}')`));
    if (hit) pyInline.push(`第 ${i + 1} 行 ${hit}：${line.trim().slice(0, 60)}`);
  });
  check(
    'build_cookbook() 不再内联判据阈值（全部读 CONTRACT）',
    fnBody.length > 0 && pyInline.length === 0,
    pyInline.join('；') || '（无）'
  );

  // ── ④ 契约必须是「被写出来的」，不是手抄进 meta.json 的 ──────────────
  check(
    'build_cookbook() 把契约写进 meta.json（`contract` 来自 CONTRACT 而不是手写字面量）',
    /'contract':\s*CONTRACT\b/.test(fnBody),
    'meta.json 里的 contract 必须是 CONTRACT 变量落盘 —— 手抄一份就等于又双写了一次'
  );

  check(
    'sync 对契约缺键是失败而不是静默回落（缺键 → fail，不许回落默认值）',
    /cbMeta\.contract/.test(syncSec) && /missingKeys\.length[\s\S]{0,160}?fail\(/.test(syncSec),
    'sync 必须先读 meta.contract，且缺键时 fail —— 回落到默认值等于藏了一份内联副本'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【24】装配台 P1 · 交付中心预检闸首屏与方案历史（09-29 夜2棒2）
//
// 口径同【17】【18】：源码即数据，字符串 / 正则判据，解析前不剥注释
// （这里扫的都是新写的组件，注释里恰好没有反例文本；真出现了就是判据写错）。
//
// 钉的是四件**会被静默改坏**的事：
//   ① 预检闸必须在交付页首屏（版面切换之上）—— 挪回双包面板里就等于把
//      「能不能交付」这个第一问题降级，09-29 三轮导出事故的病灶原样复发；
//   ② 闸门只许展示、不许自己算 lint —— 一旦组件里重算一份，两份判据必然分叉；
//   ③ 渲染路径不许抛异常（崩整页比「导出被拦」糟得多）；
//   ④ 方案历史只许消费 drafts.ts 那份键，不许出现第二个持键方。
// ═══════════════════════════════════════════════════════════════
console.log('\n【24】装配台 P1 交付中心（预检闸首屏 / 方案历史 / 形态图右栏）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');

  const gateSrc = readRel('src/app/stack/ExportGate.tsx');
  const historySrc = readRel('src/app/stack/DraftHistory.tsx');
  const deliverySrc = readRel('src/app/stack/StackDelivery.tsx');
  const scaffoldSrc = readRel('src/app/stack/steps/ScaffoldDelivery.tsx');
  const lintSrc = readRel('src/lib/export-lint.ts');
  const channelSrc = readRel('src/app/stack/useStackChannel.ts');

  check(
    '预检闸首屏化：ExportGate 挂在 StackDelivery 上，且排在版面切换（data-delivery-view）之前',
    /<ExportGate scopes=\{gateScopes\} \/>/.test(deliverySrc) &&
      deliverySrc.indexOf('<ExportGate') < deliverySrc.indexOf('data-delivery-view="preview"'),
    '闸门挪到版面切换之后就等于把它埋回页面中段 —— 进这一页看到的第一个答案必须是「能不能交付」'
  );
  check(
    '预检闸两个版面都在（渲染点在 deliveryView 分支之外，切版面不会把它切没）',
    /\{step === 'delivery' && \(\s*<div className="panel flex flex-wrap items-center gap-1\.5/.test(
      deliverySrc
    ) && !/deliveryView === '[a-z]+'[\s\S]{0,200}?<ExportGate/.test(deliverySrc),
    '闸门被塞进了某个版面的分支里'
  );
  check(
    '闸门只展示不算 lint：ExportGate 不 import lintExportFiles / 不出现 lintExportFiles( 调用',
    !/lintExportFiles/.test(gateSrc),
    '组件里重算一份判据 = 两份判据必然分叉（一处改了另一处没改，红绿对不上）'
  );
  check(
    '闸门红绿两态都有可断言落点（data-export-gate / data-gate-status / data-gate-scope-status）',
    gateSrc.includes('data-export-gate={blocked') &&
      gateSrc.includes('data-gate-status={blocked') &&
      gateSrc.includes('data-gate-scope-status={bad'),
    '没有 data 落点 = 只能靠肉眼截图判红绿，回归一定漏'
  );
  check(
    '闸门逐条 [check] message 且六类检查的人话标签齐全（duplicate-path / bean-conflict / dangling-import / pom-no-version / yml-foreign-root / module-persistence）',
    gateSrc.includes('[{v.check}]') &&
      gateSrc.includes('data-gate-violation={v.check}') &&
      [
        'duplicate-path',
        'bean-conflict',
        'dangling-import',
        'pom-no-version',
        'yml-foreign-root',
        'module-persistence',
      ].every((k) => gateSrc.includes(`'${k}':`)),
    '少一类标签，那一类的违规就只能以英文 id 示人'
  );
  check(
    '闸门渲染路径不抛异常（组件体里没有 throw / 没有 new Error）',
    !/\bthrow\b/.test(gateSrc) && !/new Error\(/.test(gateSrc),
    '渲染期 throw 会整页白屏 —— 比「导出被拦」严重得多，宁可空态也不许抛'
  );
  check(
    '两份包各自独立过闸（scopes 传入 plan.violations 与 artifacts.violations，不合成一个总数）',
    /violations: plan\.violations/.test(deliverySrc) &&
      /violations: artifacts\.violations/.test(deliverySrc) &&
      /scopes\.filter\(\(s\) => s\.violations\.length > 0\)/.test(gateSrc),
    '合成一个总数会让「其实能下载的那份包」跟着一起被判死'
  );
  check(
    '下载禁用与闸门同源：三包卡 disabled={blocked}（blocked 来自 artifacts.violations 并上项目名合法性），一键导出按钮同样被拦即灰',
    /const blocked = violations\.length > 0 \|\| !nameOk;/.test(scaffoldSrc) &&
      (scaffoldSrc.match(/disabled=\{blocked\}/g) ?? []).length >= 3 &&
      /disabled=\{plan\.violations\.length > 0 \|\| !nameOk\}/.test(deliverySrc),
    '卡片能点而闸门说被拦（或反过来）＝ 两套判据'
  );
  check(
    'export-lint 六检查计算逻辑没被绕过：LintCheck 六类字面量仍在，lintExportFiles 仍是唯一出口',
    ["'duplicate-path'", "'bean-conflict'", "'dangling-import'", "'pom-no-version'", "'yml-foreign-root'", "'module-persistence'"].every(
      (k) => lintSrc.includes(k)
    ) && /export function lintExportFiles\(/.test(lintSrc),
    '六检查是本仓导出事故的最后防线，一处都不能少'
  );

  // ── 方案历史（拍板项③）──
  const draftsSrc = readRel('src/app/stack/drafts.ts');
  const srcDir = path.join(webRoot, 'src');
  const keyHolders: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        if (fs.readFileSync(p, 'utf8').includes('arsenal-stack-drafts-v1')) {
          keyHolders.push(path.relative(webRoot, p).replace(/\\/g, '/'));
        }
      }
    }
  })(srcDir);
  // 「提到键名」与「真读写键」是两件事：注释里提一句不算持键，
  // 持键 = 真的调 getItem / setItem。判据只钉后者（前者太宽，必然误伤注释）。
  const apiUsers = keyHolders.filter(
    (f) =>
      f !== 'src/app/stack/drafts.ts' &&
      /localStorage\.(getItem|setItem)\(|window\.localStorage/.test(readRel(f))
  );
  check(
    '方案历史不改持键方：arsenal-stack-drafts-v1 仍由 drafts.ts 独家真读写（其余文件提到它只是注释）',
    draftsSrc.includes("STACK_DRAFTS_KEY = 'arsenal-stack-drafts-v1'") && apiUsers.length === 0,
    `真读写的第二处：${apiUsers.join(' ') || '无'}（提到键名的文件共 ${keyHolders.length} 个）`
  );
  check(
    '方案历史面板：空态可见（data-draft-empty）且恢复 / 删除入口齐备（data-draft-restore / data-draft-delete）',
    historySrc.includes('data-draft-empty') &&
      historySrc.includes('data-draft-restore={d.id}') &&
      historySrc.includes('data-draft-delete={d.id}'),
    '入口藏起来 = 用户以为「根本没存过」或「没这功能」'
  );
  check(
    '历史面板挂在交付页底部（版面之外，两个版面都在）且不直接读写存储（挂载后走通道的 reloadDrafts）',
    /<DraftHistory[\s\S]{0,220}?onReload=\{reloadDrafts\}/.test(deliverySrc) &&
      !/localStorage\.(getItem|setItem)\(|window\.localStorage/.test(historySrc) &&
      /onReload\(\);/.test(historySrc),
    '面板自己开一份存储副本 = 与结论条的对比下拉各读各的，删了这边那边还在'
  );
  check(
    '恢复是整份三通道回灌（restoreDraft 同时写 picks / meta / baseId 并进历史栈），不是只换 picks',
    /function restoreDraft\([\s\S]{0,700}?setPicks\(d\.picks\)[\s\S]{0,200}?setMeta\(d\.meta\)[\s\S]{0,200}?setBaseId\(d\.baseId\)/.test(
      channelSrc
    ) && /function restoreDraft\([\s\S]{0,200}?hist\.record\(snapRef\.current\)/.test(channelSrc),
    '只回灌 picks 会留着上一套的副本数与形态，拼出第三套方案 —— 最难查的那种'
  );

  // ── 运行页形态图右栏（plan §2）──
  const runSrc = readRel('src/app/stack/StackRun.tsx');
  const previewSrc = readRel('src/app/stack/TopologyPreview.tsx');
  check(
    '⑨ 形态图右栏只在 topology 步出现，且与表单两栏并排（xl 断点起分栏，窄屏堆叠）',
    /step === 'topology' \? \([\s\S]{0,200}?xl:grid-cols-\[minmax\(0,1fr\)_360px\]/.test(runSrc) &&
      // 判据不写死整行 JSX：右栏后来要传 focusDim / replicaLines（Helm 联动），
      // 写成完整字符串会跟着每次加 prop 而假红 —— 只盯「这四个 prop 都在」。
      /<TopologyPreview[\s\S]{0,300}?picks=\{picks\}[\s\S]{0,300}?meta=\{meta\}/.test(runSrc) &&
      /focusDim=\{topoFocus\}/.test(runSrc),
    '图不在这一步 = 调副本数要换页才看得到结果，等于盲调'
  );
  check(
    '形态图画法不重写：右栏预览复用 buildTopologySvg()（唯一实现处），且实例数由 figures 现算',
    /buildTopologySvg\(picks, meta, \{/.test(previewSrc) &&
      /built\.figures\.reduce\(\(n, f\) => n \+ f\.replicas, 0\)/.test(previewSrc) &&
      !/<rect|<svg xmlns/.test(previewSrc),
    '自己拼一遍几何 = 与交付预览那张图分叉，「两处画得不一样」没人会发现'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【25】装配台 P1 第二组（2026-09-30 补）：⑥ 连接三态卡 + JourneyBar
//       已选角标与 390 折叠。
//
//   四条硬要求，每一条都对应一种「看起来做完其实没做完」：
//   ① 三态必须**从数据推出来**，不许另存一份开关 —— 存了就会和 `demoMode`
//      分叉，出现「卡上说是演示模式、导出包却连真库」；
//   ② 密码「默认不落盘」的提示必须排在表单**之前** —— 填完四组字段才发现
//      密码不存，等于白填一遍；
//   ③ 角标数字从 picks 现算，且**没有维度可数的页不许渲染假角标**（0/0 也是假话）；
//   ④ 窄屏折叠只许**一套 DOM** —— 为窄屏再复制四个链接，任何按
//      `a[data-journey]` 计数的判据会立刻从 4 变 8 而毫无察觉。
// ═══════════════════════════════════════════════════════════════
console.log('\n【25】装配台 P1 第二组（连接三态卡 / JourneyBar 角标与折叠）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const envStepSrc = readRel('src/app/stack/steps/EnvStep.tsx');
  const envPageSrc = readRel('src/app/stack/StackEnv.tsx');
  const barSrc = readRel('src/app/stack/JourneyBar.tsx');

  const MODES = ['demo', 'remote', 'local'];
  check(
    '⑥ 连接三态卡三态齐备，且当前态由数据推导（demoMode + 必填是否填完），组件内不另存开关',
    MODES.every((m) => envStepSrc.includes("id: '" + m + "'")) &&
      MODES.every((m) => envStepSrc.includes('data-env-mode={m.id}')) &&
      /demoMode \? 'demo' : allRequiredFilled \? 'remote' : 'local'/.test(envStepSrc) &&
      !/useState|useRef\(/.test(envStepSrc),
    '三态另存一份 state = 与 demoMode 两份真相，「卡上说是演示、导出包却连真库」没人会发现'
  );
  check(
    '⑥ 必填字段集合取自表单事实源（forms 过滤 required），不写死字段个数',
    /forms\.flatMap\(\(f\) => f\.fields\)\.filter\(\(f\) => f\.required\)\.map\(\(f\) => f\.key\)/.test(
      envStepSrc
    ) && !/'(19|33|\d+)'/.test(envStepSrc),
    '写死个数字 = 事实源加了必填字段而角标不动，卡住的还是用户'
  );
  check(
    '密码「默认不落盘」提示前置：data-secret-note 排在数据库表单之前且只出现一次',
    // 判据带 `=""`：裸子串 `data-secret-note` 会被 `data-secret-note-LATE` 蒙过去
    // （2026-09-30 注入实测：改名成 -LATE 时这条**仍然绿** —— 子串判据的老坑）。
    /data-secret-note=""/.test(envStepSrc) &&
      envStepSrc.indexOf('data-secret-note=""') < envStepSrc.indexOf('data-env-form="database"') &&
      (envStepSrc.match(/data-secret-note=""/g) ?? []).length === 1 &&
      (envStepSrc.match(/data-remember-secrets/g) ?? []).length === 1,
    '提示沉在表单最底部 = 用户填完才发现密码不存；出现两遍 = 两处说明必然分叉'
  );
  check(
    '「本机默认」回落只清非密码必填字段（密码走既有落盘规则），键取自表单',
    /\.filter\(\(f\) => f\.required && !f\.secret\)/.test(envPageSrc) &&
      /for \(const k of keys\) delete next\[k\]/.test(envPageSrc),
    '连密码一起清 = 绕过「记住到本机」的既有约定，用户以为勾了其实没存'
  );
  check(
    'JourneyBar 角标从 picks 现算，没有维度可数的页返回 null（不渲染假角标）',
    /function pageProgress\(id: StackPageId, picks: StackPicks\)/.test(barSrc) &&
      /id === 'software' \? THEME_SECTIONS : id === 'run' \? RUN_SECTIONS : null/.test(barSrc) &&
      /if \(!src\) return null/.test(barSrc) &&
      !/'(19|33)'/.test(barSrc),
    '写一个常量当角标 = 选完件数字不动，这比没有角标更糟（它在主动说假话）'
  );
  check(
    'JourneyBar 窄屏折叠只有一套 DOM（data-journey 只出现一次），尺寸走 class 不走内联',
    (barSrc.match(/data-journey=\{p\.id\}/g) ?? []).length === 1 &&
      /h-\[26px\] w-\[26px\]/.test(barSrc) &&
      /sm:h-auto sm:w-auto/.test(barSrc) &&
      !/width: 26/.test(barSrc),
    '为窄屏复制四个链接 = 8 个 data-journey，按节点数写的判据瞬间失真；' +
      '内联 width/height 压不过 sm:w-auto，宽屏会僵成 26px 方块'
  );
  check(
    '四页都把 picks 喂给 JourneyBar（角标不看页就不可能有数）',
    ['StackSoftware.tsx', 'StackEnv.tsx', 'StackRun.tsx', 'StackDelivery.tsx'].every((f) =>
      /<JourneyBar current="[a-z]+" picks=\{picks\} \/>/.test(readRel('src/app/stack/' + f))
    ),
    '漏传一页 = 那一页角标永远是 0/0 或干脆不渲染，且不会报错'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【26】装配台 P1 第三组（2026-09-30 白天补做）
// 这四条都是「跑得对、但一直在白做」的问题，不会报错，只会慢和分叉：
//   ① 预检闸的归总每帧重算 —— 只 memo 一侧没用，调用方每帧新建数组照样废掉；
//   ② 方案历史重读存储换引用 —— 内容一个字没变却让整棵树重渲染；
//   ③ 形态图右栏自绘 —— 两处画得不一样没人会发现；
//   ④ 色值在十几个组件里各抄一遍 —— 改主题只能靠 grep 撞运气。
// ═══════════════════════════════════════════════════════════════
console.log('\n【26】装配台 P1 第三组（预检闸重算 / 草稿重读 / 色值唯一出处）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const gateSrc = readRel('src/app/stack/ExportGate.tsx');
  const deliverySrc = readRel('src/app/stack/StackDelivery.tsx');
  const draftsSrc = readRel('src/app/stack/drafts.ts');
  const channelSrc = readRel('src/app/stack/useStackChannel.ts');
  const previewSrc = stripComments(readRel('src/app/stack/TopologyPreview.tsx'));
  const paletteSrc = readRel('src/app/stack/palette.ts');
  const treeSrc = readRel('src/app/stack/ProjectTree.tsx');

  check(
    '预检闸的归总只在 useMemo 里算（闸门与调用方两侧都 memo，只做一侧等于没做）',
    /const \{ blockedScopes, blocked, total, files, tally \} = useMemo\(/.test(gateSrc) &&
      !/const blockedScopes = scopes\.filter/.test(gateSrc) &&
      /const gateScopes = useMemo<GateScope\[\]>\(/.test(deliverySrc),
    '调用方每帧新建 scopes 数组，闸门里的 useMemo 依赖一变就重算 —— 只 memo 一侧白做'
  );
  check(
    '方案历史重读有相等短路（指纹相同保留原引用，内容没变不重渲染）',
    /export function draftsKey\(list: StackDraft\[\]\): string/.test(draftsSrc) &&
      /setDrafts\(\(prev\) => \(draftsKey\(prev\) === key \? prev : next\)\)/.test(channelSrc),
    '读出来的内容一个字没变还换引用 = 整棵装配台为一次「什么都没发生」的重读重算一遍'
  );
  check(
    '形态图右栏不自绘（buildTopologySvg 只调一次，文件里没有 SVG 痕迹）',
    (previewSrc.match(/buildTopologySvg\(/g) ?? []).length === 1 &&
      !/'<svg|'<rect|stroke=/.test(previewSrc) &&
      /data-topology-preview-source="buildTopologySvg"/.test(previewSrc),
    '自己拼一遍几何 = 与交付预览那张图分叉，「两处画得不一样」没人会发现'
  );
  check(
    '装配台色值只有一处出处（不许裸写 hex / 手拼 rgba / 混用 tailwind 出厂语义色）',
    (() => {
      // 旧判据只禁「palette 里登记过的色值」—— 于是出现了三种漏网：
      //   ② 未登记色裸写：2026-10-01 实测 7 处（#80918A / #E5A33D / #3FB950 / #16211F /
      //      #9BAFB0 / #6A7F80 / #3C4D45），它们不在 palette 里，旧判据一个都抓不到 ——
      //      「登记」反而成了绕过登记的捷径；
      //   ③ tailwind 出厂语义色（rose / amber / emerald…）：实测 13 处 rose-* 用在预检闸
      //      拦截块上，与 TONE.bad 是两套红，改主色时它们纹丝不动。
      // 现在按「装配台里不许出现任何色值来源，只许 TONE / INK / SWATCH / gloss / toneAt」来判。
      const registered = new Set(
        [...paletteSrc.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0])
      );
      const FACTORY =
        'rose|amber|emerald|sky|violet|red|green|blue|yellow|orange|lime|teal|cyan|indigo|purple|pink|fuchsia|slate|gray|zinc|neutral|stone';
      const factoryRe = new RegExp(
        `(?:text|bg|border|from|to|via|ring|fill|stroke|shadow|divide|outline|decoration|accent|caret|placeholder)-(?:${FACTORY})-\\d{2,3}`,
        'g'
      );
      const stackDir = path.join(webRoot, 'src', 'app', 'stack');
      const hit: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(full);
          } else if (/\.tsx?$/.test(e.name) && e.name !== 'palette.ts') {
            const t = stripComments(fs.readFileSync(full, 'utf8'));
            const rel = path.relative(stackDir, full).replace(/\\/g, '/');
            for (const m of t.matchAll(/#[0-9A-Fa-f]{6}/g)) {
              hit.push(
                `${rel}: 裸 hex ${m[0]}${registered.has(m[0]) ? '（已登记）' : '（未登记）'}`
              );
            }
            for (const m of t.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[0-9.]+\s*\)/g)) {
              // 纯黑遮罩与纯白高光不是配色（阴影 gloss(0.10) 之类），不算裸色
              const mono =
                (m[1] === '0' && m[2] === '0' && m[3] === '0') ||
                (m[1] === '255' && m[2] === '255' && m[3] === '255');
              if (!mono) hit.push(`${rel}: 手拼 ${m[0]}`);
            }
            for (const m of t.matchAll(factoryRe)) {
              hit.push(`${rel}: tailwind 出厂语义色 ${m[0]}`);
            }
          }
        }
      };
      walk(stackDir);
      if (hit.length) console.log('    ↳ ' + hit.slice(0, 14).join('\n    ↳ '));
      return hit.length === 0;
    })(),
    '色值在组件里各抄一遍 = 改主题只能靠 grep 撞运气，漏一处就是「这块边框比别处深一点」；' +
      '混用 tailwind 出厂语义色 = 页面上有两套红，改主色时只有一套跟着变'
  );
  check(
    '徽章分类色走 SWATCH，不借语义色（TONE 的黄绿是「隐患/通过」，不是分类）',
    /const BADGE_SWATCH: Record<string, string> = \{/.test(treeSrc) &&
      /const FILE_GROUP_SWATCH: Record<string, string> = \{/.test(treeSrc) &&
      !/TONE\./.test(
        treeSrc.slice(treeSrc.indexOf('const BADGE_SWATCH'), treeSrc.indexOf('function badgeColor'))
      ) &&
      !/TONE\./.test(
        treeSrc.slice(
          treeSrc.indexOf('const FILE_GROUP_SWATCH'),
          treeSrc.indexOf('export default function ProjectTree')
        )
      ),
    '「鉴权」徽章绿得跟「校验通过」一个意思 —— 看着像评价，其实只是分类'
  );
  check(
    '半透明取色从 TONE 派生：toneAt() 读 TONE 的 hex，alpha=1 时原样返回实心色',
    /export function toneAt\(key: ToneKey, alpha = 1\): string/.test(paletteSrc) &&
      /if \(alpha >= 1\) return TONE\[key\]\.color;/.test(paletteSrc) &&
      /rgbOf\(TONE\[key\]\.color\)/.test(paletteSrc),
    'helper 里再写一份色值 = 两处真相，调主色时半透明副本不跟着变'
  );
}

// ═══════════════════════════════════════════════════════════════
// 【27】装配台 P2 三项（下载卡层级 / ⑧⑩ 右栏 / 形态图 Helm 联动）
// 这三条都是「信息摆错了地方」而不是「算错了」：
//   ① 三张下载卡平级 —— 把「我该点哪个」推给了用户；
//   ② ⑧⑩ 的后果（生成什么文件 / 拿走什么）原本只在同一页的中段才看得见；
//   ③ 形态图与 Helm 值是同一个数字，但两处各说各的，谁也没指出对方。
// ═══════════════════════════════════════════════════════════════
console.log('\n【27】装配台 P2 三项（下载卡层级 / ⑧⑩ 右栏 / 形态图 Helm 联动）');
{
  const webRoot = path.resolve(here, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(webRoot, rel), 'utf8');
  const scaffoldSrc = readRel('src/app/stack/steps/ScaffoldDelivery.tsx');
  const runSrc = readRel('src/app/stack/StackRun.tsx');
  const deliverySrc = readRel('src/app/stack/StackDelivery.tsx');
  const previewSrc = readRel('src/app/stack/TopologyPreview.tsx');
  // 去注释再判：文件头注释里写了一句「调用方传 buildDeployPlan() 的结果」，
  // 不去注释这条会因为**注释里的函数名**假红（2026-10-01 实测）。
  const deployPreviewSrc = stripComments(readRel('src/app/stack/DeployPreview.tsx'));
  const outlineSrc = readRel('src/app/stack/ProductOutline.tsx');
  const topoStepSrc = readRel('src/app/stack/steps/TopologyStep.tsx');
  const topoSrc = readRel('src/lib/topology.ts');
  const deploySrc = readRel('src/lib/deploy.ts');

  check(
    '三张下载卡分主次：全家桶是主卡且排在前面，后端 / 前端是次卡',
    /data-download="all"[\s\S]{0,160}?data-download-tier="primary"/.test(scaffoldSrc) &&
      (scaffoldSrc.match(/data-download-tier="secondary"/g) ?? []).length >= 2 &&
      scaffoldSrc.indexOf('data-download-tier="primary"') <
        scaffoldSrc.indexOf('data-download-tier="secondary"'),
    '三张一样大 = 把「我该点哪个」推给用户；主次不是装饰，是把默认答案写在版面上'
  );
  check(
    '卡上的包构成从 files 现算（topOf），不写死一句「包含后端与前端」',
    /function topOf\(files: \{ path: string \}\[\]\): string\[\]/.test(scaffoldSrc) &&
      ['all', 'backend'].every((k) => scaffoldSrc.includes(`topOf(artifacts.${k}.files)`)),
    '写死构成 = 事实源改了而卡上不动，「下载下来发现和说的不一样」'
  );
  check(
    '⑧ 交付与运行有右栏：列出这套选型会生成的部署文件，且文件由调用方生成（组件只展示）',
    /step === 'deliverRun' \? \([\s\S]{0,200}?xl:grid-cols-\[minmax\(0,1fr\)_360px\]/.test(runSrc) &&
      /<DeployPreview files=\{deployFiles\} \/>/.test(runSrc) &&
      !/buildDeployPlan\(/.test(deployPreviewSrc),
    '在 ⑧ 表态却看不见自己表出了什么 = 盲选；组件自己再生成一遍 = 两处可能对不上'
  );
  check(
    '⑩ 交付有右栏概览：按类别与顶层目录现算，不写死类别名',
    /<ProductOutline files=\{plan\.files\} bytes=\{plan\.bytes\} \/>/.test(deliverySrc) &&
      /f\.group \?\? '其它'/.test(outlineSrc) &&
      !/'(构建|配置|代码)'\s*:/.test(outlineSrc),
    '写死类别 = 事实源加了新类别而概览不动，用户数着数着对不上'
  );
  check(
    '形态图认识「当前在调谁」：buildTopologySvg 收 highlight，每张卡带 dimId 钥匙',
    /highlight\?: string;/.test(topoSrc) &&
      /dimId: string;/.test(topoSrc) &&
      /opts\.highlight === c\.dimId/.test(topoSrc) &&
      /highlight: focusDim/.test(previewSrc),
    '图上有十来个框，调副本数时不亮对应框 = 让用户自己找是哪个变了'
  );
  check(
    '副本数的落点从生成的部署文件里抽（replicaLines 读 content），不是照格式背一遍',
    /export function replicaLines\(files: DeployFile\[\]\): ReplicaLine\[\]/.test(deploySrc) &&
      /f\.content\.split\('\\n'\)/.test(deploySrc) &&
      /data-replica-line=""/.test(previewSrc) &&
      /replicaLines=\{replicaRows\}/.test(runSrc),
    '背格式 = 模板一改就对不上；抽不到就如实说「这份产物没有副本数的落点」'
  );
  check(
    '焦点是双向的：台上调哪一项 → 图上亮（onFocus 上报）；点图上的项 → 焦点回台面',
    /onFocus\?: \(target: string\) => void/.test(topoStepSrc) &&
      // `\?\.` 别漏了那个点：写成 `\?\(` 匹配的是 `onFocus?(`，而源码是 `onFocus?.(`，
      // 于是这条恒红（2026-10-01 首次真跑才暴露）。
      /onFocus\?\.\('app'\)/.test(topoStepSrc) &&
      /onFocus\?\.\(r\.id\)/.test(previewSrc) &&
      /onFocus=\{setTopoFocus\}/.test(runSrc) &&
      /focusDim=\{topoFocus\}/.test(runSrc),
    '只单向 = 用户点了图上的项没反应，以为那排按钮是装饰'
  );
}

// 【16】启动前提自检
// 「文件都在、zip 能解」说明不了应用能起。这一层守的是 09-28 实测出的启动根因：
// 主 yml 缺数据源、重复顶层键被 YAML 加载器拒绝、schema.sql 永不执行、
// 无默认值的占位符挡启动。编译与真机启动由冒烟流程覆盖，这里守静态可判定的部分。
function startupChecks() {
  console.log('\n【16】启动前提自检');

  const ymlOf = (p: StackPicks) =>
    buildExportPlan(p, auditArchitecture(p))
      .files.find((f) => f.path === 'src/main/resources/application.yml')!.content;

  const withDb = { ...defaultPicks, persistence: 'mybatisplus', database: 'mysql',
    pool: 'hikari', migration: 'flyway' } as StackPicks;
  const ymlDb = ymlOf(withDb);
  check('真库组合：主 yml 带数据源连接四件套（url/driver/username/password）',
    ymlDb.includes('datasource:') &&
      /url:\s*jdbc:(mysql|postgresql):/.test(ymlDb) &&
      ymlDb.includes('driver-class-name:') &&
      /username:\s*\$\{DB_USERNAME:/.test(ymlDb) &&
      /password:\s*\$\{DB_PASSWORD:/.test(ymlDb),
    '缺任何一件，Spring Boot 走到数据源装配那一步就会失败');
  check('真库组合：主 yml 走多文档（选项块 --- 分隔，防顶层 spring: 重复键）',
    ymlDb.includes('\n---\n'));
  check('真库组合：主 yml 无裸占位符（${VAR} 无默认值会在启动时解析失败）',
    !/\$\{[A-Z_0-9]+\}/.test(ymlDb),
    ymlDb.match(/\$\{[A-Z_0-9]+\}/g)?.slice(0, 3).join(' ') ?? '');

  const noMig = { ...defaultPicks, persistence: 'jpa', database: 'mysql',
    migration: 'none', cache: 'redis' } as StackPicks;
  const planNoMig = buildExportPlan(noMig, auditArchitecture(noMig));
  const schemaSql = planNoMig.files.find((f) => f.path === 'src/main/resources/db/schema.sql');
  check('无迁移工具：db/schema.sql 随包导出且建表幂等（IF NOT EXISTS）',
    !!schemaSql && schemaSql.content.includes('CREATE TABLE IF NOT EXISTS'),
    'sql.init 每次启动都执行，非幂等 DDL 第二次启动就撞「表已存在」');
  const ymlNoMig = planNoMig.files.find((f) => f.path === 'src/main/resources/application.yml')!.content;
  check('无迁移工具：主 yml 声明 sql.init 常驻执行并指向 db/schema.sql',
    ymlNoMig.includes('mode: always') && ymlNoMig.includes('schema-locations: classpath:db/schema.sql'),
    'schema.sql 不在 classpath 根，默认位置找不到它 —— 永不执行，user 表不存在');
  check('无迁移工具 + Redis：密码占位符带空默认',
    ymlNoMig.includes('password: ${REDIS_PASSWORD:}'),
    '没设 REDIS_PASSWORD 环境变量时，无默认值占位符直接挡启动');

  const planFly = buildExportPlan(withDb, auditArchitecture(withDb));
  check('Flyway 组合：V1__init.sql 随包导出',
    planFly.files.some((f) => f.path.endsWith('db/migration/V1__init.sql')));
  check('Flyway 组合：sql.init 不与 Flyway 双跑（主 yml 无 mode: always）',
    !ymlDb.includes('mode: always'));
}

/**
 * 【28】架构图谱合并 · 棒1 画布进台（2026-10-17）。
 *
 * 守的不是「组件能跑」，而是**合并本身不回退**：TechArch 搬进解剖台之后，
 * 三件容易静默发生的事 —— ① 画布没接扫描事实（挂个空壳还在讲装配台快照）
 * ② IR 二义（画布自己从 picks 重建一份，图上与 IR 各说各话，两边全绿）
 * ③ 编辑态串项目（扫 A 拖好的布局原样出现在 B 的图上，计划坑 1）。
 * 2026-10-17 棒3 起 /arch 退役为重定向页，「默认路径字节级不变」失去保护对象，
 * 28-8 随之改钉「TechArch 只有一个宿主」；几何与 IR 仍由 graph/archify 两层共守。
 */
function archMergeChecks() {
  console.log('\n【28】架构图谱合并 · 画布进台');
  {
    const srcFile = (rel: string) => fs.readFileSync(path.resolve(here, '..', 'src', rel), 'utf8');
    const lab = srcFile('app/autopsy/AutopsyLab.tsx');
    const tech = srcFile('app/stack/TechArch.tsx');
    const panel = stripComments(srcFile('app/autopsy/ArchPanel.tsx'));

    check(
      '28-1 架构面板拆子页签：技术架构（画布）与应用分层两个渲染分支都在',
      lab.includes("archSub === 'canvas'") && lab.includes('<ArchPanel'),
      '少了任一支，合并就只剩半张面板'
    );
    check(
      '28-2 画布接扫描事实：picks / titleRoot / irOverride 三件都传，且按项目重挂载',
      /picks=\{artifacts\.picksRes\.picks\}/.test(lab) &&
        /titleRoot=\{artifacts\.facts\.root\}/.test(lab) &&
        /irOverride=\{\{/.test(lab) &&
        /key=\{`canvas:\$\{artifacts\.facts\.root\}`\}/.test(lab),
      'picks 没接 = 画布还在讲装配台快照；key 不分项目 = 编辑态必串'
    );
    check(
      '28-3 副本事实只从部署清单读、读不到不兜底（scanMeta 走 replicaFact + withParam）',
      lab.includes('replicaFact(artifacts.facts)') &&
        lab.includes("withParam(emptyMeta(), 'replicas'"),
      '没有 replicaFact 分支，图上就会出现没有依据的「×1」'
    );
    check(
      '28-4 IR 二义收口：irOverride 传入时画布直接用 facts 版 IR 与 issues',
      /const ir: ArchifyIr = irOverride/.test(tech) &&
        /irOverride \? irOverride\.issues/.test(tech),
      '画布自己从 picks 重建 IR = 同一项目两个 IR，迟早分家而两边都全绿'
    );
    check(
      '28-5 画布主题管自己的 preset：扫描路径按画布主题重戳 visual_preset',
      /visual_preset: presetForTheme\(theme\)/.test(tech),
      'preset 跟顶部选择器走，就会「选了深色、导出的是蓝图」'
    );
    check(
      '28-6 编辑态按项目分键：扫描路径分键、默认路径维持单键',
      /function editsKeyOf\(scanMode: boolean/.test(tech) &&
        /return scanMode && titleRoot \? `\$\{STORAGE_KEY\}:\$\{titleRoot\}` : STORAGE_KEY;/.test(tech),
      '单键跨项目 = 扫 A 拖好的布局原样出现在 B（计划坑 1）'
    );
    check(
      '28-7 部署图卡片撤下、下载职能归画布工具栏（剥注释后不许再出现该卡片标题）',
      !panel.includes('技术栈部署图') && panel.includes('应用分层图'),
      '卡片还在 = 下载入口两处，副本徽章与卡片数字会对不上'
    );
    // 28-8（2026-10-17 棒3 改写）：/arch 退役 + ArchGallery 删除后，「默认路径
    // （不传 props）字节级不变」失去了保护对象 —— 没有页面再渲染裸 <TechArch />。
    // 换成钉那个还活着的不变量：TechArch 只许有一个宿主，且就是解剖台
    // （零宿主 = 画布根本没上台；多宿主 = 两份接线迟早分家，而两边都全绿）。
    const techArchHosts: string[] = [];
    const walkTechArch = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkTechArch(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const s = fs.readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '');
          if (/<TechArch[\s/>]/.test(s)) techArchHosts.push(path.relative(path.resolve(here, '../src'), p).replace(/\\/g, '/'));
        }
      }
    };
    walkTechArch(path.resolve(here, '../src'));
    check(
      '28-8 TechArch 只有一个宿主：渲染点在 AutopsyLab（/arch 退役后画廊已删）',
      techArchHosts.length === 1 && techArchHosts[0] === 'app/autopsy/AutopsyLab.tsx',
      `实际宿主: ${techArchHosts.join('、') || '无'} —— 零宿主 = 画布没上台；多宿主 = 两份接线迟早分家`
    );
  }
}

/**
 * 【29】质检台 Q1 · 数据契约 v2 后端（2026-10-18）。
 *
 * qaReport v1→v2 是 additive 契约：RuleIndex 热加载（refresh）、reload 端点（防重入）、
 * violationNode 挂规则快照（autopsy/qa 共用出口一起吃）、assemble 的 ruleset stamp 与
 * groupedByRule。这些改动跨 5 个后端文件 + 1 个前端契约文件，任何一块「悄悄退回去」，
 * 前端拿到的就是缺键报告而页面不红 —— 所以源码文本断言钉住关键形状。
 * 行为级验证（热加载正反样本 / impact 派生 / 聚合一致性）在免 Spring 探针 Q1Probe 里，
 * 本层只钉「关键接线还在」。
 */
function qaContractChecks() {
  console.log('\n【29】质检台 Q1 数据契约（热加载 / reload 端点 / 规则快照 / groupedByRule）');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const srv = (rel: string) => strip(fs.readFileSync(
    path.resolve(here, '../../arsenal-server/src/main/java/com/arsenal', rel), 'utf8'));
  const api = strip(fs.readFileSync(path.resolve(here, '../src/lib/arsenal-api.ts'), 'utf8'));

  const ruleIndex = srv('loader/RuleIndex.java');
  check(
    '29-1 RuleIndex 热加载：volatile 快照 + synchronized refresh（改规则不再必须重启）',
    /volatile Snapshot/.test(ruleIndex) && /public synchronized ReloadResult refresh\(\)/.test(ruleIndex)
      && /public Instant loadedAt\(\)/.test(ruleIndex) && /public String filesNewestMtime\(\)/.test(ruleIndex),
    'refresh / loadedAt / filesNewestMtime 缺任何一个，报告的 ruleset stamp 就是假的'
  );
  const reloadCtl = srv('web/RulesReloadController.java');
  check(
    '29-2 reload 端点存在且防重入（AtomicBoolean）',
    /@PostMapping\("\/reload"\)/.test(reloadCtl) && /AtomicBoolean/.test(reloadCtl),
    '端点没了「明天用新规则」就是空头承诺；没防重入就是并发重载炸弹'
  );
  const autopsy = srv('autopsy/AutopsyService.java');
  check(
    '29-3 violationNode 挂规则快照 + impact/impactSource（autopsy 与 qa 共用出口一起吃）',
    /mapper\.valueToTree\(rule\)/.test(autopsy) && /impactSource/.test(autopsy)
      && /RuleImpact\.of\(rule\)/.test(autopsy),
    '共用出口只吃一半 = 两份报告口径分裂（拍板项 5 选 ① 的接线证据）'
  );
  const qaService = srv('qa/QaService.java');
  check(
    '29-4 assemble 是 v2：schemaVersion=2 + ruleset stamp + groupedByRule 后端算',
    /put\("schemaVersion", 2\)/.test(qaService) && /putObject\("ruleset"\)/.test(qaService)
      && /FindingGrouper\.group\(/.test(qaService),
    'schemaVersion 忘升 = 前端按 v1 fallback 渲染新报告；groupedByRule 前端算 = 口径打架'
  );
  const grouper = srv('qa/FindingGrouper.java');
  check(
    '29-5 groupedByRule 的 count 铁律：count = items.size()（不许另设计数器）',
    /put\("count", acc\.items\.size\(\)\)/.test(grouper),
    'count 与 items.length 打架 = 聚合视图与平铺视图数字不一致（验收写死的那条）'
  );
  const impact = srv('domain/RuleImpact.java');
  check(
    '29-6 impact 派生单一出处 + 两级来源标注（rule-impact / rule-rationale）',
    /"rule-impact"/.test(impact) && /"rule-rationale"/.test(impact)
      && /MAX_LEN = 120/.test(impact),
    '派生逻辑散两处 / 来源标注丢了 = 派生内容伪装成真 impact（诚实披露纪律）'
  );
  check(
    '29-7 前端契约 additive：QaReport 带 ruleset?/groupedByRule?，finding 带 rule?/impact?/impactSource?（全可选 = v1 报告仍能打开）',
    /ruleset\?: QaRulesetStamp/.test(api) && /groupedByRule\?: QaRuleGroup\[\]/.test(api)
      && /rule\?: QaRuleSnapshot/.test(api) && /impactSource\?: string/.test(api),
    '写成必填 = 旧 v1 报告在类型层就打不开（P0② 反着验的锚点）'
  );
}

/** 质检台 Q2（2026-10-18）：前端重构的结构断言 —— 7 组件 / 两视图对账 / 六段详情 / v1 fallback / 黄条 */
function qaFrontendChecks() {
  const qaDir = path.resolve(here, '../src/app/qa');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const qa = (f: string) => strip(fs.readFileSync(path.resolve(qaDir, f), 'utf8'));
  const files = [
    'BoundaryCard.tsx',
    'FindingsView.tsx',
    'FindingRow.tsx',
    'RuleGroupCard.tsx',
    'SourceNote.tsx',
    'RecsPanel.tsx',
    'TestsPanel.tsx',
  ];
  check(
    '30-1 QaLab 拆 7 组件齐活（src/app/qa/，QaLab 只剩状态机与编排）',
    files.every((f) => fs.existsSync(path.resolve(qaDir, f)))
      && !/function (HardPanel|SemanticPanel|CommitteePanel|RecsPanel|TestsPanel)\b/.test(qa('QaLab.tsx')),
    '组件没拆出去 = 单文件继续膨胀；旧面板函数还留在 QaLab 里 = 假拆'
  );
  const fv = qa('FindingsView.tsx');
  check(
    '30-2 两视图对账是页面的一部分：crossCheck 逐档比对 + 打架上墙（不只测试里）',
    /export function crossCheck/.test(fv)
      && /两视图对账/.test(fv)
      && /mismatches\.map/.test(fv)
      && /≠/.test(fv),
    '对账只活在测试里 = 用户看到的还是打架的页面'
  );
  const fr = qa('FindingRow.tsx');
  check(
    '30-3 静态 finding 六段详情固定顺序齐活 + 复制降级（file:// 不给必失败按钮）',
    /① 问题是什么/.test(fr)
      && /② 在哪/.test(fr)
      && /③ 违反了哪条/.test(fr)
      && /④ 依据出处/.test(fr)
      && /⑤ 不修的后果/.test(fr)
      && /⑥ 正例（规则库自带）/.test(fr)
      && /file:/.test(fr)
      && /禁写剪贴板/.test(fr),
    '六段缺段 / file:// 下塞一个点了必失败的复制按钮 = 验收⑤落空'
  );
  const bc = qa('BoundaryCard.tsx');
  check(
    '30-4 规则库账 + 黄条 + 一键 reload（意见 9 落地：已变更未重载必须可见可执行）',
    /filesNewestMtime/.test(bc)
      && /loadedAt/.test(bc)
      && /规则库文件已变更但未重载/.test(bc)
      && /rulesReload\(\)/.test(bc)
      && /versionBefore/.test(bc),
    '黄条没了 = 「明天用新规则」退回空头承诺'
  );
  check(
    '30-5 v1 fallback 纪律：缺键渲染人话，不许渲染成 0 或空白',
    /这份报告没带「按规则」聚合数据/.test(fv)
      && /这份报告没带规则库账/.test(bc)
      && /这份报告没带规则快照/.test(fr),
    '缺键渲染成 0 = 把「没数据」说成「没违规」（措辞层第 4 条铁律）'
  );
}

zipChecks().then(() => {
  profileChecks();
  startupChecks();
  archMergeChecks();
  qaContractChecks();
  qaFrontendChecks();
  projectIdsParityChecks();
  process.exit(finish('project'));
});

// ═══════════════════════════════════════════════════════════════
// 【31】统一 projectId：Node 与后端逐字节一致（治「两套算法对不上」暗伤）
// ═══════════════════════════════════════════════════════════════
function projectIdsParityChecks() {
  console.log('\n【31】统一 projectId：Node 与后端（ProjectIds）逐字节一致');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const serverRoot = path.resolve(here, '../../arsenal-server/src/main/java/com/arsenal');
  const projectIdsSrc = strip(fs.readFileSync(path.join(serverRoot, 'projects/ProjectIds.java'), 'utf8'));
  const qaServiceSrc = strip(fs.readFileSync(path.join(serverRoot, 'qa/QaService.java'), 'utf8'));

  // 固定向量：规范化 = kind + ":" + value.trim().replace('\\','/').replaceAll("/+$","")
  // 后端用 MessageDigest SHA-256，与 node:crypto 输出逐字节一致（标准算法）。
  const vectors: Array<[string, string]> = [
    ['path', 'D:/work/order-service'],
    ['git', 'https://github.com/foo/bar.git'],
    ['path', '  ./local/ '],
    ['git', 'https://u:token@github.com/secret/repo.git'],
    ['path', 'C:\\\\projects\\\\demo'],
    ['path', '/home/user/proj/'],
    ['path', '/home/user/proj//'],
  ];
  let allMatch = true;
  for (const [kind, value] of vectors) {
    const got = projectIdOf(kind, value);
    const norm = `${kind}:${value.trim().replace(/\\/g, '/').replace(/\/+$/, '')}`;
    const ref = createHash('sha256').update(Buffer.from(norm, 'utf8')).digest('hex').slice(0, 12);
    if (got !== ref) allMatch = false;
  }
  check(
    '31-1 Node projectIdOf 与 SHA-256 前 12 位逐字节一致（固定向量对拍，含尾斜杠归一与大小写反例）',
    allMatch,
    'Node 与后端算法不一致 = 缓存目录 <id>/ 与 QA 历史 <id>/ 永远对不上'
  );

  // 反例：差一个字符必须得到不同 id（断言「判据方向没写反」：用了不同输入确实会变）
  const a = projectIdOf('path', 'D:/work/order-service');
  const b = projectIdOf('path', 'D:/work/order-servicE');
  check(
    '31-2 反例：kind+value 差一个字符 → 不同 id（防止「算两份」各算各的都恰好撞上）',
    a !== b,
    '单字符差异都得同 id = 算法退化为常量，两套系统照样对不上'
  );

  // 后端源码断言：ProjectIds 用 SHA-256 + HexFormat 取前 12 位
  check(
    '31-3 后端 ProjectIds.projectIdOf 用 SHA-256 + HexFormat 取前 12 位（单一事实源）',
    /MessageDigest\.getInstance\("SHA-256"\)/.test(projectIdsSrc)
      && /formatHex\(d\)\.substring\(0, 12\)/.test(projectIdsSrc)
      && /public static String projectIdOf/.test(projectIdsSrc),
    '后端算法写成别的形式 = 与 Node 对拍向量会漂移'
  );

  // QaService 必须委托，不再自带第二份算法
  const delegates = /return ProjectIds\.projectIdOf\(kind, ref\);/.test(qaServiceSrc);
  const hasOwnSha = /MessageDigest\.getInstance\("SHA-256"\)/.test(qaServiceSrc);
  check(
    '31-4 QaService.projectIdOf 委托给 ProjectIds（单一事实源，无第二份 sha256 副本）',
    delegates && !hasOwnSha,
    'QaService 里还藏着一份 sha256 = 两套算法迟早漂移'
  );
}
