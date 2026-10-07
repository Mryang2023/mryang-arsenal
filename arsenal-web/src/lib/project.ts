import projRaw from '@/generated/project.json';
import { auditArchitecture, capLabel, STATUS_META, type ArchAudit, type ArchGap, type GapRemedy } from './arch';
import type { ComposedStack, StackPicks } from './content-types';
import { baseById, bootVersionOf, composeStack, dimensionById, dimensions, renderPom, renderYaml } from './stack';
import { buildArchDiagram, archDiagramD2, archDiagramMermaid } from './arch-diagram';
import { buildDeployPlan } from './deploy';
import { lintExportFiles, needsExplicitVersion, type LintViolation } from './export-lint';

/**
 * 项目结构层。
 *
 * 它把「选型」翻译成「磁盘上的东西」，供三个出口共用：
 *   ① 结构图  —— 哪些目录会有、哪些不会、每一块是谁带来的
 *   ② 启动类  —— 完整可粘贴的 Application.java（含开关归属表）
 *   ③ 导出包  —— 一份能直接放进 IDE 的项目骨架
 *
 * 三个出口读的是同一份 project.json，所以改一处结构，三处同时变。
 * 这是「一份数据三种出口」在选型台上的第三次出现 —— 第一次是规则，第二次是架构，这里是结构。
 *
 * 一条自我约束：**这里生成的每一个文件都必须真的有用**。
 * 为了凑数生成一堆空目录、空类，只会让用户觉得导出包是垃圾。
 * 所以宁可少几个文件，也要保证 README 里的每一句话都能对得上包里的实际内容。
 */

// ─────────────────────────────────────────────────────────────
// 数据
// ─────────────────────────────────────────────────────────────

export interface TreeNode {
  name: string;
  desc: string;
  kind: 'dir' | 'file';
  badge?: string;
  when?: Record<string, string[]>;
  children?: TreeNode[];
}

export interface AppAnnotation {
  code: string;
  import: string;
  comment: string;
  source: string;
  when?: Record<string, string[]>;
}

export interface SwitchOwner {
  switch: string;
  owner: string;
  why: string;
  when?: Record<string, string[]> | null;
}

export interface StructureNote {
  title: string;
  text: string;
  rule?: string | null;
}

/**
 * 脚手架代码条目。variants 按声明顺序匹配，第一个 when 命中的胜出；
 * 不带 when 的是兜底变体（构建期校验：至多一个，且必须在最后）。
 */
export interface ScaffoldVariant {
  when?: Record<string, string[]> | null;
  code: string;
}

export interface ScaffoldFile {
  path: string;
  group: '构建' | '源码' | '配置' | '数据' | '文档' | '测试' | '部署' | '前端源码' | '前端配置';
  from: string;
  desc: string;
  variants: ScaffoldVariant[];
}

export interface ProjectDoc {
  groupId: string;
  artifactId: string;
  basePackage: string;
  tree: TreeNode;
  appTemplate: string;
  appAnnotations: AppAnnotation[];
  switchOwners: SwitchOwner[];
  scaffold: ScaffoldFile[];
  files: {
    gitignore: string;
    flywayV1: string;
    liquibaseMaster: string;
    smokeTest: string;
    gradleSettings: string;
    readmeTemplate: string;
    readmeStartMaven: string;
    readmeStartGradle: string;
  };
  structureNotes: StructureNote[];
  structureLegend: { tone: string; text: string }[];
}

export const projectDoc = projRaw as unknown as ProjectDoc;

// Spring Boot 版本不再写死：由「技术栈基底」决定（见 buildExportPlan 的 baseId）
// 早先这里是 const SPRING_BOOT_VERSION = '3.2.5' —— 那是硬编码，改基底改不动它。
const JAVA_PACKAGE_DIR = projectDoc.basePackage.replace(/\./g, '/');
const JAVA_MAIN = `src/main/java/${JAVA_PACKAGE_DIR}`;
const JAVA_TEST = `src/test/java/${JAVA_PACKAGE_DIR}`;
const RES = 'src/main/resources';

// ─────────────────────────────────────────────────────────────
// 条件求值
// ─────────────────────────────────────────────────────────────

/**
 * 判定一个 when 条件是否成立。
 *
 * 语义与架构层完全一致（维度之间「与」，选项列表内部「或」），
 * 这样同一份选型在两个地方不会得出不同结论。
 * 不写条件 = 恒成立；槽位为空 = 不成立（空不等于「任意」）。
 */
export function condMet(
  when: Record<string, string[]> | undefined | null,
  picks: StackPicks
): boolean {
  if (!when) return true;
  return Object.entries(when).every(([dim, opts]) => {
    const picked = picks[dim];
    return !!picked && opts.includes(picked);
  });
}

/** 当前是否选中了某个维度的某个选项 */
export function picked(dim: string, opts: string[], picks: StackPicks): boolean {
  const v = picks[dim];
  return !!v && opts.includes(v);
}

// ─────────────────────────────────────────────────────────────
// 结构图：按选型过滤目录树
// ─────────────────────────────────────────────────────────────

/**
 * 过滤目录树。
 *
 * 规则：节点自身条件成立，且（若是目录）过滤后还剩子节点。
 * 后半句很重要 —— 否则会出现「resources/mapper/ 显示着，但里面什么都没有」，
 * 用户会照着建一个空目录，然后怀疑整张图。
 */
export function filterTree(nodes: TreeNode[], picks: StackPicks): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (!condMet(node.when, picks)) continue;
    if (node.kind === 'dir') {
      const children = filterTree(node.children ?? [], picks);
      if (!children.length) continue;
      out.push({ ...node, children });
    } else {
      out.push(node);
    }
  }
  return out;
}

export interface TreeStats {
  dirs: number;
  files: number;
  java: number;
  resources: number;
  test: number;
  badges: string[];
}

export function treeStats(nodes: TreeNode[], prefix = ''): TreeStats {
  const stats: TreeStats = { dirs: 0, files: 0, java: 0, resources: 0, test: 0, badges: [] };
  const collect = (list: TreeNode[], path: string) => {
    for (const n of list) {
      const here = `${path}/${n.name}`;
      if (n.kind === 'dir') {
        stats.dirs += 1;
        collect(n.children ?? [], here.replace(/\/$/, ''));
      } else {
        stats.files += 1;
        if (n.name.endsWith('.java')) {
          stats.java += 1;
          if (here.includes('/test/')) stats.test += 1;
        } else if (here.includes('/resources/')) {
          stats.resources += 1;
        }
        if (n.badge && !stats.badges.includes(n.badge)) stats.badges.push(n.badge);
      }
    }
  };
  collect(nodes, prefix);
  return stats;
}

// ─────────────────────────────────────────────────────────────
// 目录树：从导出清单合成 —— zip 里有什么，树里画什么
// ─────────────────────────────────────────────────────────────

/**
 * 09-28 十反馈（货不对版）之后的新口径：
 *
 * 事实源 project.json 的 tree 是一份**静态满配蓝图**（common/user/job/security
 * 等业务示例文件永远画在上面）。过去 README 的目录树按 when 过滤这份蓝图 ——
 * 但过滤条件再准，也过滤不掉「永远不会被生成的文件」：业务六件套从来不在
 * buildExportPlan 的产出里，树里却一直画着，用户解包一对就穿帮。
 *
 * 现在树只有一个来源：**导出清单本身**。清单里的路径逐个拆进层级，说明文字
 * 优先复用事实源里同路径节点的 desc（那些文案是资产，不浪费）；清单里没有
 * 的路径，一步都不会出现在树里 —— 树与 zip 不可能再分叉。
 */

/** 收集事实源静态树的「相对路径 → 说明」映射（跳过根节点本身）。
 *  静态树的目录名带尾斜杠（'src/'），拼路径前先去掉，否则键是 src//main 这种。 */
function collectTreeDescs(node: TreeNode, prefix = '', map = new Map<string, string>()): Map<string, string> {
  for (const c of node.children ?? []) {
    const clean = c.name.replace(/\/$/, '');
    const here = prefix ? `${prefix}/${clean}` : clean;
    if (c.kind === 'file' && c.desc) map.set(here, c.desc);
    if (c.kind === 'dir') collectTreeDescs(c, here, map);
  }
  return map;
}

type PathTree = Map<string, PathTree | { desc?: string }>;

/**
 * 从文件路径清单合成目录树。
 *
 * 排序确定性：同层先目录后文件，各自按名排序 —— 同一份清单永远渲染出
 * 同一棵树。空目录不可能出现：目录只在有文件落进来时才存在。
 */
export function treeFromFiles(
  files: { path: string; desc?: string }[],
  rootName: string
): TreeNode {
  const descs = collectTreeDescs(projectDoc.tree);

  const rootMap: PathTree = new Map();
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.split('/');
    let cur: PathTree = rootMap;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const next = cur.get(seg);
      if (!next) {
        const dir: PathTree = new Map();
        cur.set(seg, dir);
        cur = dir;
      } else if (next instanceof Map) {
        cur = next;
      } else {
        throw new Error(`路径冲突：${f.path} 既是文件又是目录`);
      }
    }
    const leaf = parts[parts.length - 1];
    if (cur.has(leaf)) throw new Error(`路径冲突：${f.path} 重复`);
    cur.set(leaf, { desc: f.desc });
  }

  const toNodes = (map: PathTree, prefix: string): TreeNode[] => {
    const dirs: TreeNode[] = [];
    const fileNodes: TreeNode[] = [];
    for (const [name, val] of map) {
      const here = prefix ? `${prefix}/${name}` : name;
      if (val instanceof Map) {
        // 结构树约定：目录名以 / 结尾（渲染与断言都按这个口径拼路径）
        dirs.push({ name: `${name}/`, desc: '', kind: 'dir', children: toNodes(val, here) });
      } else {
        fileNodes.push({
          name,
          desc: val.desc ?? descs.get(here) ?? '',
          kind: 'file',
        });
      }
    }
    const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name);
    dirs.sort(byName);
    fileNodes.sort(byName);
    return [...dirs, ...fileNodes];
  };

  return { name: rootName, desc: '', kind: 'dir', children: toNodes(rootMap, '') };
}

/**
 * 渲染成等宽文本树，供 README 使用。
 *
 * 同一层的说明文字按最长名字对齐 —— 不对齐的树在等宽字体里看着像一团麻，
 * 而这份树是要被贴进 README、发给别人看的。
 */
export function renderTreeNodesText(root: TreeNode, maxDesc = 58): string {
  const lines: string[] = [root.name];

  const clip = (s: string) => (s.length > maxDesc ? `${s.slice(0, maxDesc - 1)}…` : s);

  const walk = (nodes: TreeNode[], prefix: string) => {
    const width = nodes.reduce((w, n) => Math.max(w, displayWidth(n.name)), 0);
    nodes.forEach((n, i) => {
      const last = i === nodes.length - 1;
      const branch = last ? '└── ' : '├── ';
      const gap = ' '.repeat(Math.max(1, width - displayWidth(n.name) + 2));
      const desc = n.desc ? `${gap}${clip(n.desc)}` : '';
      lines.push(`${prefix}${branch}${n.name}${desc}`);
      if (n.kind === 'dir') {
        walk(n.children ?? [], `${prefix}${last ? '    ' : '│   '}`);
      }
    });
  };

  walk(root.children ?? [], '');
  return lines.join('\n');
}

/** 导出清单 → 树条目：空内容的文件标「占位文件」，README 固定一句自述。
 *  清单里已有 README（plan.files）就不重复补 —— 两种调用形态都成立。 */
function treeEntriesOf(files: { path: string; content?: string }[], readmeDesc: string) {
  const entries = files.map((f) => ({
    path: f.path,
    desc: f.path === 'README.md' ? readmeDesc : f.content ? undefined : '占位文件',
  }));
  if (!entries.some((e) => e.path === 'README.md')) {
    entries.unshift({ path: 'README.md', desc: readmeDesc });
  }
  return entries;
}

/**
 * 导出包的目录树 —— README 与 ⑦ 交付台面**共用这一个函数**。
 * zip 里有什么，树里就画什么；两边要分叉只能是一起分叉。
 */
export function exportTreeNodes(
  files: { path: string; content?: string }[],
  projectName?: string
): TreeNode {
  const name = (projectName ?? '').trim() || projectDoc.artifactId;
  return treeFromFiles(
    treeEntriesOf(files, '这份 README 由装配台生成：选型表 + 目录结构 + 启动步骤 + 隐患清单'),
    `${name}/`
  );
}

/**
 * 兼容壳（verify 的【2】层按 picks 断言树内容用）：
 * 内部走与 buildExportPlan 完全相同的清单合成 —— 树 = zip，不是第二套口径。
 */
export function renderTreeText(picks: StackPicks, maxDesc = 58): string {
  const files = collectExportFiles(picks, auditArchitecture(picks));
  const root = exportTreeNodes(files);
  return renderTreeNodesText(root, maxDesc);
}

// ─────────────────────────────────────────────────────────────
// 等宽对齐：中文算两列
// ─────────────────────────────────────────────────────────────

/** 字符串在等宽字体下占多少列。CJK 与全角符号占 2 列。 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0x303e) ||
      (cp >= 0x3041 && cp <= 0x33ff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

export function padTo(s: string, columns: number): string {
  return s + ' '.repeat(Math.max(0, columns - displayWidth(s)));
}

// ─────────────────────────────────────────────────────────────
// 启动类
// ─────────────────────────────────────────────────────────────

const APP_IMPORT_BASE = [
  'import org.springframework.boot.SpringApplication;',
  'import org.springframework.boot.autoconfigure.SpringBootApplication;',
];

/** 按选型装配 Application.java。 */
export function renderAppClass(picks: StackPicks): string {
  const active = projectDoc.appAnnotations.filter((a) => condMet(a.when, picks));

  const imports = [
    ...APP_IMPORT_BASE,
    ...active.map((a) => `import ${a.import};`),
  ].join('\n');

  // 注解块的注释要能解释「这一行为什么在这里」，所以带上来源
  const annotations = active.length
    ? active.map((a) => `${a.code}   // ← ${a.source}`).join('\n')
    : '// （当前选型没有需要挂在启动类上的注解 —— 全局开关都在各自的配置类里）';

  const owners = projectDoc.switchOwners.filter((s) => condMet(s.when, picks));
  const colSwitch = Math.max(
    displayWidth('开关'),
    ...owners.map((o) => displayWidth(o.switch))
  );
  const colOwner = Math.max(
    displayWidth('归属'),
    ...owners.map((o) => displayWidth(o.owner))
  );
  const switchLines = [
    ` *   ${padTo('开关', colSwitch)}  ${padTo('归属', colOwner)}  作用`,
    ` *   ${'─'.repeat(colSwitch)}  ${'─'.repeat(colOwner)}  ${'─'.repeat(26)}`,
    ...owners.map(
      (o) => ` *   ${padTo(o.switch, colSwitch)}  ${padTo(o.owner, colOwner)}  ${o.why}`
    ),
  ].join('\n');

  return projectDoc.appTemplate
    .replace('__IMPORTS__', imports)
    .replace('__ANNOTATIONS__', annotations)
    .replace('__SWITCHES__', switchLines);
}

// ─────────────────────────────────────────────────────────────
// 构建文件：Gradle
// ─────────────────────────────────────────────────────────────

/**
 * 生成 build.gradle。
 *
 * 与 pom 的差别不只是语法：Maven 的 scope 在 Gradle 里要拆成不同的配置项，
 * 而注解处理器（Lombok、MapStruct）在 Maven 里只是一个 provided 依赖，
 * 在 Gradle 里必须同时进 compileOnly 与 annotationProcessor ——
 * 少写后者时的表现是「编译过了，但 Lombok 生成的 getter 全是红」，极难自己反应过来。
 */
export function renderGradle(
  composed: ComposedStack,
  javaVersion: string,
  bootVersion = '3.2.12'
): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const { dimension, option } of composed.selected) {
    const deps: string[] = [];
    for (const d of option.dependencies ?? []) {
      if (d.kind || !d.groupId || !d.artifactId) continue;
      const key = `${d.groupId}:${d.artifactId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Gradle 没有 parent 传递 BOM 的说法，版本来源是 io.spring.dependency-management
      // 导入的 spring-boot-dependencies：BOM 管辖内可不写版本，管辖外（nacos 生态等）
      // 必须显式拼上 —— 否则 Gradle 解析依赖那一步直接失败，与 Maven 侧同族事故。
      const bare = `${d.groupId}:${d.artifactId}`;
      const coord =
        d.version && needsExplicitVersion(d.groupId) ? `${bare}:${d.version}` : bare;
      const isProcessor = d.scope === 'provided';
      if (d.scope === 'test') deps.push(`    testImplementation '${coord}'`);
      else if (isProcessor) {
        // 注解处理器必须两行都写，只写 compileOnly 会导致注解不生效
        deps.push(`    compileOnly '${coord}'`);
        deps.push(`    annotationProcessor '${coord}'`);
      } else if (d.scope === 'runtime') deps.push(`    runtimeOnly '${coord}'`);
      else deps.push(`    implementation '${coord}'`);
      if (d.note) deps.push(`    // ${d.note}`);
    }
    if (deps.length) blocks.push(`    // ── ${dimension.name} · ${option.name}\n${deps.join('\n')}`);
  }

  // 文件头与 pom 的生成注释同源：来源、版本纪律、怎么跑 —— 三件事写在最前面，
  // 解包的人第一眼就知道这份文件是谁给的、该守什么规矩。
  lines.push('// ═══════════════════════════════════════════════════════════════');
  lines.push('// 由「军火库 · 架构装配台」按当前组合生成。');
  lines.push('// 版本纪律：业务依赖不手写版本号 —— 版本由 io.spring.dependency-management');
  lines.push('// 导入的 spring-boot-dependencies BOM 统一管辖；BOM 管不到的（nacos 生态、');
  lines.push('// jakarta.persistence-api 等）必须显式带版本，否则 Gradle 解析依赖直接失败。');
  lines.push('// 注解处理器（Lombok / MapStruct）必须同时进 compileOnly 与 annotationProcessor，');
  lines.push('// 少写后者时编译能过、生成的 getter 却是红的。');
  lines.push(`// 启动：gradle bootRun → http://localhost:8080（Boot ${bootVersion} / Java ${javaVersion}）`);
  lines.push('// ═══════════════════════════════════════════════════════════════');
  lines.push('plugins {');
  lines.push("    id 'java'");
  lines.push(`    id 'org.springframework.boot' version '${bootVersion}'`);
  lines.push("    id 'io.spring.dependency-management' version '1.1.4'");
  lines.push('}');
  lines.push('');
  lines.push(`group = '${projectDoc.groupId}'`);
  lines.push("version = '1.0.0'");
  lines.push('');
  lines.push('java {');
  lines.push(`    toolchain { languageVersion = JavaLanguageVersion.of(${javaVersion}) }`);
  lines.push('}');
  lines.push('');
  lines.push('repositories {');
  lines.push('    mavenCentral()');
  lines.push('}');
  lines.push('');
  lines.push('dependencies {');
  lines.push('    // 版本一律交给 Spring Boot 插件管理的 BOM，不手写版本号');
  lines.push(blocks.join('\n\n'));
  lines.push('}');
  lines.push('');
  lines.push('tasks.named(\'test\') {');
  lines.push('    useJUnitPlatform()');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// profile 配置
// ─────────────────────────────────────────────────────────────

/** 生产 profile。核心约定：这个文件会进仓库，所以不能有任何明文密钥。 */
export function renderProdYaml(picks: StackPicks): string {
  const out: string[] = [
    '# 生产环境覆盖项。',
    '# 这个文件会被提交进仓库 —— 所以它里面不能出现任何明文密钥，',
    '# 所有敏感值一律写成 ${ENV_VAR}，由部署环境注入。',
    '',
    'server:',
    '  port: ${SERVER_PORT:8080}',
    '  # 优雅停机：收到信号后先停止接收新请求，等在途请求结束再退出',
    '  shutdown: graceful',
  ];

  if (picked('persistence', ['jdbc', 'mybatisplus', 'jpa'], picks) && picks.database) {
    out.push(
      '',
      'spring:',
      '  datasource:',
      '    url: ${DB_URL}',
      '    username: ${DB_USERNAME}',
      '    password: ${DB_PASSWORD}',
      '    hikari:',
      '      maximum-pool-size: ${DB_POOL_SIZE:20}',
      '      connection-timeout: 3000'
    );
  }

  if (picked('cache', ['redis'], picks)) {
    out.push('', '  data:', '    redis:', '      host: ${REDIS_HOST}', '      password: ${REDIS_PASSWORD}');
  }

  if (picked('apidoc', ['springdoc', 'knife4j'], picks)) {
    out.push(
      '',
      '# 接口文档在生产必须关闭：它会暴露全部接口结构，连鉴权规则都交代清楚',
      'springdoc:',
      '  swagger-ui:',
      '    enabled: false',
      'knife4j:',
      '  enable: false'
    );
  }

  if (picked('observability', ['actuator', 'prometheus'], picks)) {
    out.push(
      '',
      'management:',
      '  endpoints:',
      '    web:',
      '      exposure:',
      '        # 只暴露必要的端点。/env、/heapdump 这类绝不能出现在公网',
      '        include: health,info,prometheus',
      '  endpoint:',
      '    health:',
      '      show-details: never'
    );
  }

  out.push('', 'logging:', '  level:', '    root: INFO', '    com.example: INFO', '  file:', '    name: /var/log/app/arsenal-demo.log');
  return `${out.join('\n')}\n`;
}

/** 开发 profile：本地差异 + 便于排查的日志级别。 */
export function renderDevYaml(picks: StackPicks): string {
  const out: string[] = [
    '# 开发环境差异项。只放「和别的环境不一样」的配置，重复项一律不抄。',
    '',
    'logging:',
    '  level:',
    '    root: INFO',
    '    com.example: DEBUG',
    '    # 打开它能看到实际执行的 SQL —— 排查问题时比打印日志有效得多，但只在本地开',
    '    org.springframework.jdbc.core: DEBUG',
  ];
  if (picked('persistence', ['mybatisplus'], picks)) {
    out.push('', 'mybatis-plus:', '  configuration:', '    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl');
  }
  if (picked('apidoc', ['springdoc', 'knife4j'], picks)) {
    out.push('', 'springdoc:', '  swagger-ui:', '    enabled: true');
  }
  return `${out.join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────────────────────

export interface ExportFile {
  path: string;
  content: string;
  /** 界面分组用 */
  group: '构建' | '源码' | '配置' | '数据' | '文档' | '测试' | '部署' | '前端源码' | '前端配置';
  /** 这一份是哪个模块带来的（空 = 基础文件） */
  from?: string;
}

export interface ExportPlan {
  files: ExportFile[];
  bytes: number;
  dangling: DanglingRef[];
  /** 导出预检闸：包自洽性检查（同名 bean / 重复文件 / 悬空 import / 无版本依赖 / yml 异类键） */
  violations: LintViolation[];
  kind: 'maven' | 'gradle';
}

export interface DanglingRef {
  /** 被引用的全限定类名 */
  fqn: string;
  /** 预期落位 */
  path: string;
  /** 谁引用了它 */
  usedBy: string[];
}

/** 取 markdown 表格里的竖线安全的文本 */
function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function selectionTableMarkdown(picks: StackPicks): string {
  const rows: string[] = [];
  for (const dim of dimensions) {
    const optId = picks[dim.id];
    const opt = optId ? dim.options.find((o) => o.id === optId) : undefined;
    rows.push(
      `| ${cell(dim.name)} | ${opt ? `**${cell(opt.name)}**` : '—'} | ${cell(opt?.summary ?? '未选型')} |`
    );
  }
  return ['| 模块 | 当前选择 | 说明 |', '| --- | --- | --- |', ...rows].join('\n');
}

function gapMarkdown(gap: ArchGap): string {
  const out: string[] = [`**${gap.title}**`, '', gap.detail, ''];
  if (gap.trigger) out.push(`- 触发条件：${gap.trigger}`);
  if (gap.symptoms?.length) {
    out.push('- 会看到的现象：');
    for (const s of gap.symptoms) out.push(`  - ${s}`);
  }
  if (gap.impact) out.push(`- 后果：${gap.impact}`);
  if (gap.consequences?.length) {
    for (const c of gap.consequences) out.push(`- 连带影响：${c}`);
  }
  if (gap.remedies?.length) {
    out.push('- 怎么补：');
    for (const r of gap.remedies.slice(0, 3)) {
      const d = dimensions.find((x) => x.id === r.dim);
      const opt = d?.options.find((o) => o.id === r.option);
      out.push(`  - ${d?.name ?? r.dim}${opt ? ` → ${opt.name}` : ''}`);
    }
    if (gap.remedies.length > 3) {
      out.push(`  - 另外 ${gap.remedies.length - 3} 个槽位也能补上这项能力`);
    }
  }
  if (gap.fix) out.push(`- 对策：${gap.fix}`);
  out.push('');
  return out.join('\n');
}

export function riskReportMarkdown(picks: StackPicks, audit: ArchAudit, name: string): string {
  const out: string[] = [`# 隐患体检单 · ${name}`, ''];
  out.push(
    `由「杨先生的军火库 · 架构装配台」按当前选型生成。`,
    `结论：**${audit.status === 'broken' ? '跑不起来' : audit.status === 'incomplete' ? '能跑，但零件不全' : '可以跑起来'}**`,
    ''
  );

  if (!audit.blockers.length && !audit.gaps.length && !audit.risks.length && !audit.notes.length) {
    out.push('未发现隐患。这一套组合零件齐全、能力闭环、没有组合冲突。', '');
    return out.join('\n');
  }

  const sections: [string, ArchGap[]][] = [
    ['跑不起来', audit.blockers],
    ['缺件（能启动，但少能力）', audit.gaps],
    ['组合隐患（单独看都对，拼起来出事）', audit.risks],
    ['提示（知道就行）', audit.notes],
  ];
  for (const [title, list] of sections) {
    if (!list.length) continue;
    out.push(`## ${title}（${list.length}）`, '');
    for (const g of list) out.push(gapMarkdown(g));
  }

  out.push('---', '');
  out.push(
    '> 改完选型之后请重新导出一份。隐患是「组合」的属性 ——',
    '> 换掉任意一个零件，结论都可能变，让这份单子和实际配置脱节比没有单子更危险。'
  );
  return `${out.join('\n')}\n`;
}

/**
 * 架构说明文档。
 *
 * 与 architecture.svg（由 arch-diagram.ts 生成）是同一份数据的两种读法：
 * 图回答「长什么样」，这份文档回答「为什么是这样、缺了什么」。
 * 两者都从 picks + audit 现算，不存在「图改了文档没改」的可能。
 */
export function architectureDocMarkdown(picks: StackPicks, audit: ArchAudit, name: string): string {
  const built = buildArchDiagram({ picks, audit, title: name });
  const { model } = built;
  const out: string[] = [];

  out.push(`# 架构说明 · ${name}`, '');
  out.push('由「杨先生的军火库 · 架构装配台」按当前选型生成。', '');
  out.push(
    '本文与 `architecture.svg` 是同一份数据的两种读法：图看形状，这里看理由。',
    '改完选型请重新导出 —— 图与文字都会跟着变，但**只有重新导出才会变**。',
    ''
  );
  out.push(`结论：**${STATUS_META[audit.status].label}**`, '');
  out.push(STATUS_META[audit.status].summary, '');

  // ── 一、分层结构与当前落位 ──
  out.push('## 一、分层结构与当前落位', '');
  out.push('| 泳道 | 这一层负责什么 | 当前选择 |');
  out.push('| --- | --- | --- |');
  for (const lane of model.lanes) {
    const installed = lane.slots.map((s) => {
      if (s.state === 'filled' || s.state === 'conflict') return s.title;
      if (s.state === 'missing-required') return `**缺（必需）**`;
      if (s.state === 'missing-recommended') return '未装（建议）';
      return '—';
    });
    const desc = lane.desc.replace(/\n/g, ' ');
    out.push(`| **${cell(lane.name)}** | ${cell(desc)} | ${cell(installed.join('；')) || '—'} |`);
  }
  out.push('');

  // ── 二、请求链路 ──
  // 这一段是这张图存在的理由：其余信息选型表里也有，只有「请求怎么穿过」是图独有的。
  // 措辞必须克制 —— 只有数据里真的定义了层内流水线，才谈得上「先后」与「旁路」。
  // 平铺一层（例如鉴权、文档、缓存）本来就不分先后，硬造一个顺序比不写更误导。
  out.push('## 二、请求链路', '');
  out.push(
    '请求自接入层进入，向下穿过各层。**有层内流水线的层按下面的顺序流经**；',
    '没有流水线的层，其零件是并列关系，不存在先后。',
    ''
  );
  for (const lane of model.lanes) {
    if (!lane.slots.length) continue;
    let line: string;
    if (lane.pipelineCount >= 2) {
      const onPath = lane.slots.slice(0, lane.pipelineCount);
      line = `- **${lane.name}**：${onPath.map((s) => s.title).join(' → ')}`;
      const bypass = lane.slots.slice(lane.pipelineCount);
      if (bypass.length) {
        line += `　旁路件：${bypass.map((s) => s.title).join('、')}（不在请求路径上）`;
      }
    } else if (lane.slots.length === 1) {
      line = `- **${lane.name}**：${lane.slots[0].title}`;
    } else {
      line = `- **${lane.name}**：${lane.slots.map((s) => s.title).join('、')}（并列，无先后）`;
    }
    out.push(line);
  }
  out.push('');

  // ── 三、能力供需 ──
  out.push('## 三、能力供需', '');
  out.push(
    `当前组合共提供 **${audit.providedCaps.length}** 项能力。`,
    '每个零件声明它提供什么、需要什么，校验时求一次并集 —— 所以「缺什么」是算出来的，不是列出来的。',
    ''
  );
  if (audit.unmetCaps.length) {
    out.push('以下能力被索要、但当前无人提供：', '');
    const remedyByCap = new Map<string, GapRemedy[]>();
    for (const b of audit.blockers) {
      if (b.unmetCap) remedyByCap.set(b.unmetCap, b.remedies ?? []);
    }
    for (const cap of audit.unmetCaps) {
      const remedies = remedyByCap.get(cap) ?? [];
      if (remedies.length) {
        const first = remedies[0];
        const d = dimensions.find((x) => x.id === first.dim);
        const opt = d?.options.find((o) => o.id === first.option);
        out.push(
          `- \`${cap}\` ${capLabel(cap)} —— 怎么补：到「${d?.name ?? first.dim}」` +
            `${opt ? `选「${opt.name}」` : '补齐'}`
        );
      } else {
        out.push(`- \`${cap}\` ${capLabel(cap)} —— 事实源里暂无零件能提供，需先扩事实源`);
      }
    }
  } else {
    out.push('没有「被索要却无人提供」的能力 —— 供需是闭环的。');
  }
  out.push('');

  // ── 四、缺口与隐患 ──
  // 直接复用隐患体检单的正文，但从第一个二级标题开始切 —— 它的 H1 与结论行
  // 在本文档开头已经写过一遍了，复制过来就成了同一段话连着说两次。
  const risk = riskReportMarkdown(picks, audit, name);
  const riskLines = risk.split('\n');
  const firstSection = riskLines.findIndex((l) => l.startsWith('## '));
  out.push('## 四、缺口与隐患', '');
  if (firstSection >= 0) {
    // 降一级：这份单子被嵌进本文档的一节，保持它自己的 ## 会与本文的章节平级
    const demoted = riskLines
      .slice(firstSection)
      .map((l) => (l.startsWith('## ') ? `#${l}` : l))
      .join('\n')
      .trim();
    out.push(demoted, '');
  } else {
    out.push('未发现隐患 —— 这一套组合零件齐全、能力闭环、没有组合冲突。', '');
  }

  // ── 五、图例 ──
  out.push('## 五、怎么读那张图', '');
  out.push(
    '- **一条横向色带 = 一层泳道**，色带名字左边写着这一层有几个槽位',
    '- **实线方块 = 已选**；**虚线方块 = 未选** —— 可选件留空是正常状态，不是问题',
    '- **红色虚线 = 缺必需**（项目起不来）；**黄铜虚线 = 缺建议**（能跑，但少能力）',
    '- **黄铜实线 + ⚠ = 已选，但它参与了某个组合隐患** —— 单独看每个零件都对，拼起来才出问题',
    '- 方块右上角的「必需 / 建议」是**该槽位留空时的性质**，不是当前状态',
    '- 层内 `→` 是请求真正流经的顺序；**竖虚线右侧是旁路件**（例如迁移工具只在发布期起作用）',
    '- 图上的 `architecture.d2` / `architecture.mermaid` 是同一张图的源码，想自己改图就拿去渲染'
  );
  out.push('');

  return `${out.join('\n')}\n`;
}

/** README 里那句「当前组合如何」—— 一句话，把结论和缺口数说清。 */
function archSummaryMarkdown(audit: ArchAudit): string {
  const parts: string[] = [];
  parts.push(`当前组合：**${STATUS_META[audit.status].label}**`);
  parts.push(`必选 ${audit.stats.requiredFilled}/${audit.stats.requiredTotal} 已装`);
  parts.push(`共 ${audit.stats.filled}/${audit.stats.total} 个槽位已选`);
  if (audit.blockers.length) parts.push(`${audit.blockers.length} 项缺失或冲突会导致起不来`);
  else if (audit.gaps.length) parts.push(`${audit.gaps.length} 项建议补齐`);
  return `${parts.join(' · ')}。`;
}

/**
 * 导出文件汇总。等价于「这套选型的产物」在磁盘上的完整落位。
 *
 * `projectName` 是用户在装配台 ① 项目定义里起的名字。它必须**贯通**所有出口：
 * pom 的 artifactId、application.yml 的 spring.application.name、K8s / Compose 的
 * 应用名、README 与风险报告的标题、架构图的标题、导出 zip 的文件名。
 * 只改其中一两处，用户解压后会拿着一个「包名是 order.service、K8s 里叫
 * arsenal-demo」的工程 —— 两边都不报错，但那是两套名字在打架。
 * 不传就回落事实源的默认 artifactId（内部调用与后端导出都还走这条）。
 */
/**
 * 导出包的文件全集（不含 README 自身）—— 树、交付清单、zip 三方共同的事实源。
 * 09-28 十反馈起 README 目录树也从这份清单合成：清单里没有的文件，树里就不会出现。
 * audit 只影响文档类文件的**内容**，不影响「有哪些文件」。
 */
export function collectExportFiles(
  picks: StackPicks,
  audit: ArchAudit,
  baseId?: string,
  projectName?: string
): ExportFile[] {
  const composed = composeStack(picks);
  const files: ExportFile[] = [];
  const isGradle = picks.build === 'gradle';
  const javaVersion = composed.properties['java.version'] ?? '17';
  // 基底决定 pom parent / gradle 插件里写的 Spring Boot 版本
  const bootVersion = bootVersionOf(baseId);
  // 所选基底未覆盖时 bootVersionOf 会回落到骨架基线 —— 这个差异必须写进 pom，
  // 否则用户「选了 4.1 拿到 3.2」却找不到任何解释（09-29 事故的真实质疑）
  const pickedBase = baseId ? baseById.get(baseId) : undefined;
  const baseNote =
    pickedBase && pickedBase.covered === false
      ? `注意：所选基底「${pickedBase.name}」本平台尚未覆盖（骨架按 3.x 编写），` +
        `pom parent 回落到骨架基线 ${bootVersion}。升级该基底前请勿手改此版本。`
      : undefined;
  const name = (projectName ?? '').trim() || projectDoc.artifactId;

  // ── 构建文件 ──
  if (isGradle) {
    files.push({ path: 'build.gradle', content: renderGradle(composed, javaVersion, bootVersion), group: '构建' });
    files.push({ path: 'settings.gradle', content: projectDoc.files.gradleSettings, group: '构建' });
  } else {
    files.push({
      path: 'pom.xml',
      content: renderPom(composed, name, bootVersion, baseNote),
      group: '构建',
    });
  }
  files.push({ path: '.gitignore', content: projectDoc.files.gitignore, group: '构建' });

  // ── 启动类 ──
  files.push({
    path: `${JAVA_MAIN}/Application.java`,
    content: renderAppClass(picks),
    group: '源码',
  });

  // ── 选型带来的配置类 ──
  // 只导出带真实路径的：有些 configClasses 的 path 写的是用法说明，它们不是文件。
  for (const c of composed.configClasses) {
    if (!c.path || !c.path.endsWith('.java')) continue;
    const dir = c.path.includes('/test/') ? JAVA_TEST : JAVA_MAIN;
    const file = c.path.includes('/test/')
      ? c.path.replace(/^src\/test\/java\/com\/example\//, `${JAVA_TEST}/`)
      : c.path.replace(/^src\/main\/java\/com\/example\//, `${JAVA_MAIN}/`);
    files.push({
      path: file.startsWith('src/') ? file : `${dir}/${c.className}.java`,
      content: c.code,
      group: '源码',
      from: `${c.dimName} · ${c.optName}`,
    });
  }

  // ── 脚手架代码：common 全家桶 / 认证实现 / user 领域六件套 / 日志与建表 ──
  // 「能够正常运行的脚手架」的本体：树上画出来的每个 Java 文件，这里都有真实代码。
  // 同一文件可能有多个变体（按持久层 / 鉴权 / 消息队列分叉），
  // 按声明顺序取第一个 when 命中的；不带 when 的是兜底变体，必须排在最后。
  for (const s of projectDoc.scaffold ?? []) {
    const hit = s.variants.find((v) => condMet(v.when ?? null, picks));
    if (!hit) continue;
    files.push({ path: s.path, content: hit.code, group: s.group, from: s.from });
  }

  // ── 配置文件 ──
  // appName 必须传：主 yml 里 spring.application.name 与数据源库名默认值都跟随项目名
  files.push({ path: `${RES}/application.yml`, content: renderYaml(composed, name), group: '配置' });
  files.push({ path: `${RES}/application-dev.yml`, content: renderDevYaml(picks), group: '配置' });
  files.push({ path: `${RES}/application-prod.yml`, content: renderProdYaml(picks), group: '配置' });

  // ── 数据层配套 ──
  if (picked('migration', ['flyway'], picks)) {
    files.push({
      path: `${RES}/db/migration/V1__init.sql`,
      content: projectDoc.files.flywayV1,
      group: '数据',
      from: '数据库迁移 · Flyway',
    });
  } else if (picked('migration', ['liquibase'], picks)) {
    files.push({
      path: `${RES}/db/changelog/db.changelog-master.xml`,
      content: projectDoc.files.liquibaseMaster,
      group: '数据',
      from: '数据库迁移 · Liquibase',
    });
  }
  if (picked('persistence', ['mybatisplus'], picks)) {
    files.push({
      path: `${RES}/mapper/.gitkeep`,
      content: '',
      group: '数据',
      from: '持久层 · MyBatis-Plus',
    });
  }

  // ── 交付与运行清单 ──
  // 文件名与结构树里的节点逐一对齐：结构图画出 deploy/k8s/04-deployment.yaml，
  // 导出包就必须真有它。两边任何一边多了少了，用户照着图会找不到文件 ——
  // 这个一致性由 npm run verify:project 断言。
  for (const f of buildDeployPlan(picks, composed, { appName: name })) {
    files.push({ path: f.path, content: f.content, group: '部署', from: f.from });
  }

  // ── 测试 ──
  if (picks.test) {
    files.push({
      path: `${JAVA_TEST}/ApplicationTests.java`,
      content: projectDoc.files.smokeTest,
      group: '测试',
      from: '测试策略',
    });
  }

  // ── 文档 ──
  files.push({
    path: 'docs/risk-report.md',
    content: riskReportMarkdown(picks, audit, name),
    group: '文档',
  });

  // ── 架构图与技术说明 ──
  // 图用浅色主题：这份 SVG 多半在白底的 GitHub、IDE 预览或 Word 里被看到，
  // 站内那套暗色是给屏幕上的产品界面用的，进了文档就成了黑块。
  // 也正因为 SVG 是纯文本，它才落在这个「只打文本文件」的打包器能力范围里。
  const diagram = buildArchDiagram({
    picks,
    audit,
    title: name,
    theme: 'light',
  });
  files.push({ path: 'architecture.svg', content: diagram.svg, group: '文档' });
  files.push({
    path: 'ARCHITECTURE.md',
    content: architectureDocMarkdown(picks, audit, name),
    group: '文档',
  });
  // 顺手把同一张图的 DSL 源码也给了：拼字符串不要钱，而想自己改图、改配色、
  // 接进自己文档流水线的人，拿了这两个文件就能继续，我们不必为此背一个图引擎。
  files.push({ path: 'architecture.d2', content: archDiagramD2(diagram.model), group: '文档' });
  files.push({
    path: 'architecture.mermaid',
    content: archDiagramMermaid(diagram.model),
    group: '文档',
  });

  return files;
}

export function buildExportPlan(
  picks: StackPicks,
  audit: ArchAudit,
  baseId?: string,
  projectName?: string
): ExportPlan {
  const isGradle = picks.build === 'gradle';
  const name = (projectName ?? '').trim() || projectDoc.artifactId;

  // 路径唯一性：重名文件在 zip 里会互相覆盖，而且不会有任何报错。
  // 去重必须发生在 README 渲染之前 —— 目录树吃的就是这份去重后的清单。
  const files = collectExportFiles(picks, audit, baseId, projectName);
  const seen = new Set<string>();
  const unique = files.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  // 目录树从导出清单合成（09-28 十反馈「货不对版」）：
  // README 里画的 = zip 里装的，两边要分叉只能一起分叉。
  const treeText = renderTreeNodesText(exportTreeNodes(unique, projectName));
  const startBlock = isGradle
    ? projectDoc.files.readmeStartGradle
    : projectDoc.files.readmeStartMaven;
  const dangling = findDanglingRefs(unique);

  // 交付清单里必须包含 README 自己 —— 清单是在 README 生成之前算出来的，
  // 不显式插进去就会出现「清单里没有 README」这种低级但一眼可见的漏洞。
  const fileList = [
    { path: 'README.md', lines: 0, self: true },
    ...unique.map((f) => ({
      path: f.path,
      lines: f.content ? f.content.split('\n').length : 0,
      self: false,
    })),
  ]
    .map((f) =>
      f.self
        ? `- \`${f.path}\` — 本文件`
        : `- \`${f.path}\`${f.lines ? ` — ${f.lines} 行` : ' — 占位文件'}`
    )
    .join('\n');

  const riskBlock = riskReportMarkdown(picks, audit, name)
    .split('\n')
    .slice(1)
    .join('\n')
    .trim();

  const danglingBlock = dangling.length
    ? dangling
        .map((d) => `- \`${d.fqn}\` → 预期位置 \`${d.path}\`（被 ${d.usedBy.join('、')} 引用）`)
        .join('\n')
    : '没有发现悬空引用 —— 导出包里的文件引用关系是自洽的。';

  const readme = projectDoc.files.readmeTemplate
    .replace('__SELECTION_TABLE__', selectionTableMarkdown(picks))
    .replace('__ARCH_SUMMARY__', archSummaryMarkdown(audit))
    .replace('__TREE__', treeText)
    .replace('__START__', startBlock)
    .replace('__RISKS__', riskBlock)
    .replace('__DANGLING__', danglingBlock)
    .replace('__FILES__', fileList);

  unique.unshift({ path: 'README.md', content: readme, group: '文档' });

  return {
    files: unique,
    bytes: unique.reduce((n, f) => n + f.content.length, 0),
    dangling,
    violations: lintExportFiles(unique),
    kind: isGradle ? 'gradle' : 'maven',
  };
}

/**
 * 找出「被引用、但不在包里」的类。
 *
 * 为什么值得专门算一遍：
 *   脚手架代码（SCAFFOLD）与配置类（configClasses）是两批来源，
 *   前者按选型分叉、后者挂在具体选项上 —— 只要有一边 when 写错，
 *   就会出现「SecurityConfig 引用了包里不存在的 JwtAuthenticationFilter」。
 *   与其在 README 里含糊地说「部分类需自行实现」，不如**算出来具体是哪些**：
 *   正常组合下这里必须是 0 —— 归零才是「开箱即跑」的证明。
 *
 * 只扫 import 行。同包内不加 import 的引用扫不到，这是已知的边界 ——
 * 宁可少报（漏掉几条需要人工补），不要多报（把已有文件也列成缺失，会消耗掉信任）。
 */
export function findDanglingRefs(files: ExportFile[]): DanglingRef[] {
  const present = new Set(files.map((f) => f.path));
  const map = new Map<string, Set<string>>();
  const base = `${projectDoc.groupId}.`;

  for (const f of files) {
    if (!f.path.endsWith('.java')) continue;
    for (const line of f.content.split('\n')) {
      const m = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/.exec(line);
      if (!m) continue;
      const fqn = m[1];
      if (!fqn.startsWith(base)) continue;
      // 静态 import 可能指向方法或常量，取到类名为止（去掉可能的成员名）
      const parts = fqn.split('.');
      const clsIdx = parts.findIndex((p) => /^[A-Z]/.test(p));
      if (clsIdx < 0) continue;
      const classFqn = parts.slice(0, clsIdx + 1).join('.');
      const path = `src/main/java/${classFqn.replace(/\./g, '/')}.java`;
      const testPath = `src/test/java/${classFqn.replace(/\./g, '/')}.java`;
      if (present.has(path) || present.has(testPath)) continue;
      if (!map.has(classFqn)) map.set(classFqn, new Set());
      map.get(classFqn)!.add(f.path);
    }
  }

  return [...map.entries()]
    .map(([fqn, usedBy]) => ({
      fqn,
      path: `src/main/java/${fqn.replace(/\./g, '/')}.java`,
      usedBy: [...usedBy].sort(),
    }))
    .sort((a, b) => a.fqn.localeCompare(b.fqn));
}

// ─────────────────────────────────────────────────────────────
// 界面用的汇总
// ─────────────────────────────────────────────────────────────

export interface StructureSummary {
  dirs: number;
  files: number;
  treeNodes: number;
  exportFiles: number;
  exportBytes: number;
  dangling: number;
  kind: 'maven' | 'gradle';
}

export function summarize(plan: ExportPlan, picks: StackPicks): StructureSummary {
  const stats = treeStats(filterTree(projectDoc.tree.children ?? [], picks), projectDoc.tree.name);
  return {
    dirs: stats.dirs,
    files: stats.files,
    treeNodes: stats.dirs + stats.files,
    exportFiles: plan.files.length,
    exportBytes: plan.bytes,
    dangling: plan.dangling.length,
    kind: plan.kind,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export { dimensionById, dimensions };
