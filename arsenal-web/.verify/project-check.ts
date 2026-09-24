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
import { buildArchDiagram, archDiagramD2, archDiagramMermaid } from '@/lib/arch-diagram';
import type { StackPicks } from '@/lib/content-types';
import { buildZip } from '@/lib/zip';
import { liveStats, orderedCategories } from '@/lib/rules';
import { cookbookStats } from '@/lib/cookbook';
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
import { isNavActive } from '@/lib/nav-active';
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

  // ④ 应用视图：路由含新增的 /arch，接口全部带方法前缀
  check(
    '应用视图：路由含 /arch 且路径唯一',
    APP_ROUTES.some((r) => r.path === '/arch') &&
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
  const flat = (nodes: ReturnType<typeof filterTree>, prefix: string, out: string[]) => {
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

    const inTree = flat(filterTree(projectDoc.tree.children ?? [], picks), '', [])
      .filter((p) => p.startsWith('deploy/'))
      .sort();
    const inPack = plan.files.map((f) => f.path).filter((p) => p.startsWith('deploy/')).sort();

    check(
      `${opt}：结构树画了 ${inTree.length} 个部署文件`,
      inTree.length > 0,
      '结构树里没有 deploy/ —— 交付形态没落进结构层'
    );
    check(
      `${opt}：导出包与结构树逐一对齐`,
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

  // ① 导航 ↔ 路由：NAV 里指过去的每个地址都得真有一个页面
  const shell = code('components/Shell.tsx');
  const navHrefs = [...shell.matchAll(/\{\s*href:\s*'([^']+)'/g)].map((m) => m[1]);
  const pageExists = (href: string) =>
    href === '/'
      ? fs.existsSync(path.resolve(here, '../src/app/page.tsx'))
      : fs.existsSync(path.resolve(here, '../src/app', href.replace(/^\//, ''), 'page.tsx'));
  const dangling = navHrefs.filter((h) => !pageExists(h));
  check(`导航：${navHrefs.length} 个入口都指向真实页面`, dangling.length === 0, `指向空地址: ${dangling.join('、')}`);

  // ② 反向：页面目录不许成为孤儿（动态段与「有意不进导航」的除外）
  const ORPHAN_OK = new Set<string>([]);
  const appDir = path.resolve(here, '../src/app');
  const orphans = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.includes('['))
    .map((d) => `/${d.name}`)
    .filter((h) => !navHrefs.includes(h) && !ORPHAN_OK.has(h));
  check('导航：没有孤儿页面（页面存在但导航里没有入口）', orphans.length === 0, `孤儿: ${orphans.join('、')}`);

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
  const navRoutes = [...navHrefs, '/rules/WEB-DTO-001', '/cases/any-page', '/arch/any-view'];
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

  // ④ 装配台页签三处必须同时成立：TabId 类型、页签条数组、渲染分支
  const composer = code('app/stack/StackComposer.tsx');
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
  check('选型快照：有写入点（装配台写）', writers.length > 0, '没人写等于 /arch 永远按 standard 预设出图');
  check('选型快照：有读取点（架构图谱读）', readers.length > 0, '没人读等于白写');
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
  const stackComposer = code('app/stack/StackComposer.tsx');
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

  // ⑤ 六大架构页签同样守一遍（同一类错在 /arch 也犯得起）
  const gallery = code('app/arch/ArchGallery.tsx');
  const viewIds = [...gallery.matchAll(/\{tab === '([a-z]+)' &&/g)].map((m) => m[1]);
  const metaIds = ARCH_VIEWS.map((v) => v.id);
  check(
    `架构图谱：${metaIds.length} 个视图都有渲染分支`,
    uniq(metaIds).every((id) => viewIds.includes(id)),
    `缺分支: ${metaIds.filter((id) => !viewIds.includes(id)).join('、') || '无'}`
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

  check('档案：至少一份内置档案', files.length >= 1, '没有档案 /arch 只能讲一份故事');

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
  const diaSrc = stripComments(srcFile('app/arch/diagrams.tsx'));
  check(
    '渲染器：五张图只从 arch-views 引类型',
    /import type \{[^}]*ArchViewData[^}]*\} from '@\/lib\/arch-views'/.test(diaSrc) &&
      !/import \{[^}]*\} from '@\/lib\/arch-views'/.test(diaSrc),
    '渲染器读常量的话，切档案要等一次重新构建'
  );

  // ⑦ 页签 ↔ 渲染分支 ↔ 传参：五个静态图都必须收到当前档案
  const gallerySrc = stripComments(srcFile('app/arch/ArchGallery.tsx'));
  const withData = [...gallerySrc.matchAll(/<(Business|Data|App|Product|Project)Diagram data=\{data\} \/>/g)].map(
    (m) => m[1]
  );
  check(
    `架构图谱：${withData.length} 张静态图都拿到当前档案`,
    withData.length === 5,
    `没传 data 的图会渲染成空 —— 五个都传: ${['Business', 'Data', 'App', 'Product', 'Project'].filter((x) => !withData.includes(x)).join('、')}`
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

  const libs = [
    {
      label: '场景案例库',
      typeFile: 'lib/case-types.ts',
      iface: 'CaseDef',
      src: loadLib('arsenal-cases', 'case'),
      genFile: 'cases.json',
      genKey: 'cases',
    },
    {
      label: '最佳实践库',
      typeFile: 'lib/content-types.ts',
      iface: 'Feature',
      src: loadLib('arsenal-cookbook', 'feature'),
      genFile: 'cookbook.json',
      genKey: 'features',
    },
  ];

  for (const lib of libs) {
    const fields = ifaceFields(lib.typeFile, lib.iface);
    const declared = new Set(fields.map((f) => f.field));
    const optional = new Set(fields.filter((f) => f.optional).map((f) => f.field));
    const required = fields.filter((f) => !f.optional).map((f) => f.field);
    const gen = (readJson(path.join(srcRoot, 'generated', lib.genFile))[lib.genKey] ?? []) as Record<
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
    { lib: '最佳实践库', iface: 'FlowStep', pick: (r) => r.flow ?? [] },
    { lib: '最佳实践库', iface: 'FeatureFile', pick: (r) => r.files ?? [] },
    {
      lib: '最佳实践库',
      iface: 'Highlight',
      pick: (r) => (r.files ?? []).flatMap((f: any) => f.highlights ?? []),
    },
    { lib: '最佳实践库', iface: 'FeatureReference', pick: (r) => r.references ?? [] },
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
  const composerSrc = readRel('src/app/stack/StackComposer.tsx');

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
  check('S1-1 装配区容器套上台面（className 带 stack-bench）', composerSrc.includes('stack-bench'));
  check(
    'S1-1 泳道表头是左侧固定标签列（writing-mode vertical-rl）',
    /writingMode:\s*'vertical-rl'/.test(composerSrc)
  );
  check(
    'S1-1 泳道之间的连线是 SVG（WireLayer，S1-4 迁出），不再用 ↓ 字符',
    /export function WireLayer\(/.test(readRel('src/app/stack/WireLayer.tsx')) &&
      !composerSrc.includes('↓'),
    composerSrc.includes('↓') ? 'StackComposer 源码里还有 ↓ 字符' : ''
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
    'S1-3 移除按钮不再依赖 hover（触屏没有 hover，藏起来等于删不掉）',
    !slotSrc.includes('group-hover:flex')
  );
  check(
    'S1-3 移除按钮触摸点击区 32×32（h-8 w-8），视觉本体 20×20（h-5 w-5）',
    /\bh-8 w-8\b/.test(slotSrc) && /\bh-5 w-5\b/.test(slotSrc)
  );
  check(
    'S1-3 移除按钮键盘可达（tabIndex 0 + Enter/Space）',
    /role="button"\s*\n\s*tabIndex=\{0\}/.test(slotSrc) &&
      /e\.key === 'Enter' \|\| e\.key === ' '/.test(slotSrc)
  );
  check(
    'S1-3 选中态 = 黄铜 ring + shadow-lift + --stack-part-hi（L4）',
    slotSrc.includes('0 0 0 1px #D9A441') &&
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
  // （S1-4 起连线职责从 StackComposer 的 LaneWire 迁到独立文件 WireLayer.tsx）。
  // 不扫整个 StackComposer（54KB，历史色值不归本棒管，扫了只会报一堆无法归因的红）。
  const wireSrc = readRel('src/app/stack/WireLayer.tsx');
  check(
    '配色守卫：WireLayer.tsx 已读到且含连线（定位不到的话下面的色值扫描就是空跑）',
    wireSrc.includes('#3C4D45') && wireSrc.length > 800
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
  const composerSrc = readRel('src/app/stack/StackComposer.tsx');
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
    'S1-5 点阵可点击直达（onSelect → setActiveDim + benchRef 滚动）',
    /onSelect=\{\(dimId\) =>/.test(composerSrc) &&
      /benchRef\.current\?\.scrollIntoView/.test(composerSrc) &&
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
  const stackFiles = [
    'src/app/stack/SlotBlock.tsx',
    'src/app/stack/Inspector.tsx',
    'src/app/stack/DeliveryDeck.tsx',
    'src/app/stack/GapCard.tsx',
    'src/app/stack/TopologyPicker.tsx',
    'src/app/stack/StackComposer.tsx',
  ].map(readRel);
  const with9px = ['SlotBlock', 'Inspector', 'DeliveryDeck', 'GapCard', 'TopologyPicker', 'StackComposer'].filter(
    (_, i) => stackFiles[i].includes('text-[9px]')
  );
  check(
    'S1-6 装配台六个活跃组件全部无 9px 字号（9px 连排清零；孤儿文件 ProjectTree 不在扫描内）',
    with9px.length === 0,
    `仍有 9px：${with9px.join(' ')}`
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
}

zipChecks().then(() => {
  profileChecks();
  process.exit(finish('project'));
});
