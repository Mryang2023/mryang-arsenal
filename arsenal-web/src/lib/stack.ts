import raw from '@/generated/stack.json';
import type {
  ComposedStack,
  ConfigClass,
  Dependency,
  Sample,
  Stack,
  StackDimension,
  StackOption,
  StackPicks,
} from './content-types';
import type { CodeLayer } from './content-types';

/**
 * 技术选型台入口与合成引擎。
 *
 * 设计要点：合成是纯函数。
 *   composeStack(picks) → ComposedStack，无副作用、无 IO。
 * 这样后端可以复用完全相同的逻辑产出同样的 pom / yaml，
 * 保证「同一份选择在任何出口得到的产物一致」。
 */
export const stack = raw as unknown as Stack;
export const dimensions: StackDimension[] = stack.dimensions;
export const groups = stack.groups;
export const presets = stack.presets;

export const dimensionById = new Map(dimensions.map((d) => [d.id, d]));

// ── 技术栈基底（全局声明，不进 dimensions） ──
// 装配台顶部单独选择；它只驱动「与基底绑定」的产物（pom parent / gradle 插件版本）。
export const bases = stack.bases;
export const defaultBase = stack.defaultBase;
export const baseById = new Map(bases.map((b) => [b.id, b]));

/**
 * 取某个基底的「Spring Boot 版本号」。
 *
 * 只有 covered 的 Boot 基底才带真实可用的版本号；未覆盖的基底（Quarkus 等）
 * 或未知 id 一律回落到默认基底的版本 —— 绝不拿一个假的版本号去拼产物。
 */
export function bootVersionOf(baseId: string | undefined): string {
  const b = baseId ? baseById.get(baseId) : undefined;
  if (b && b.covered && /^\d/.test(b.version)) return b.version;
  const d = baseById.get(defaultBase);
  return d && /^\d/.test(d.version) ? d.version : '3.2.12';
}

const DEFAULT_BOOT_VERSION = bootVersionOf(defaultBase);

/** 全空画布：所有槽位都未选。这是「从零开始搭架构」的起点。 */
export function emptyPicks(): StackPicks {
  return Object.fromEntries(dimensions.map((d) => [d.id, '']));
}

/** 默认选择：每个维度取 defaultOption（用于「恢复推荐配置」） */
export const defaultPicks: StackPicks = Object.fromEntries(
  dimensions.map((d) => [d.id, d.defaultOption])
);

/**
 * 预设 → picks。
 *
 * 关键语义：预设里没声明的维度**留空**，不回填默认值。
 * 预设表达的是「这套取舍选了哪些零件」，一旦用默认值补齐就失去这个含义了 ——
 * 「单体最小集」会被补成满配，看起来和「生产标配」没区别。
 */
export function presetPicks(presetId: string): StackPicks {
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return { ...defaultPicks };
  const merged = emptyPicks();
  for (const [dim, opt] of Object.entries(preset.picks)) {
    if (dimensionById.has(dim)) merged[dim] = opt;
  }
  return merged;
}

/** 取某个维度的当前选项（空槽位回退到第一项，供展示兜底用） */
export function optionOf(dim: StackDimension, picks: StackPicks): StackOption {
  const id = picks[dim.id];
  return dim.options.find((o) => o.id === id) ?? dim.options[0];
}

/**
 * 已填槽位（跳过空槽位）。
 * 产物合成只应处理真正选了的东西 —— 空槽位若回退到默认选项，
 * pom 里就会出现用户根本没选过的依赖。
 */
export function selectedEntries(
  picks: StackPicks
): { dimension: StackDimension; option: StackOption }[] {
  const out: { dimension: StackDimension; option: StackOption }[] = [];
  for (const dimension of dimensions) {
    const id = picks[dimension.id];
    if (!id) continue;
    const option = dimension.options.find((o) => o.id === id);
    if (option) out.push({ dimension, option });
  }
  return out;
}

/**
 * 依赖去重。
 *
 * 同一个坐标可能被多个维度同时声明（例如多个选项都要 actuator）。
 * 去重时保留首次出现的版本与作用域，合并注释 —— 重复写入会让 pom 直接编译失败。
 */
function dedupeDeps(list: Dependency[]): Dependency[] {
  const seen = new Map<string, Dependency>();
  for (const d of list) {
    if (d.kind) continue; // Gradle 插件等非 Maven 依赖，不进 pom
    if (!d.groupId || !d.artifactId) continue;
    const key = `${d.groupId}:${d.artifactId}`;
    if (seen.has(key)) continue;
    seen.set(key, d);
  }
  return [...seen.values()];
}

/** 把 yaml 片段缩进统一到两格，避免拼接后层级错乱 */
function normalizeYaml(body: string): string {
  return body
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();
}

/** 主合成函数 —— 只处理已填槽位 */
export function composeStack(picks: StackPicks): ComposedStack {
  const selected = selectedEntries(picks);

  const dependencies: Dependency[] = [];
  const properties: Record<string, string> = {};
  const yamlBlocks: ComposedStack['yamlBlocks'] = [];
  const configClasses: ComposedStack['configClasses'] = [];
  const samples: ComposedStack['samples'] = [];
  const ops: ComposedStack['ops'] = [];
  const env: ComposedStack['env'] = [];
  const notes: ComposedStack['notes'] = [];
  const pitfalls: ComposedStack['pitfalls'] = [];

  for (const { dimension, option } of selected) {
    dependencies.push(...(option.dependencies ?? []));
    Object.assign(properties, option.pomProperties ?? {});

    if (option.yaml && option.yaml.trim()) {
      yamlBlocks.push({
        dimName: dimension.name,
        optName: option.name,
        body: normalizeYaml(option.yaml),
      });
    }
    for (const c of option.configClasses ?? []) {
      configClasses.push({ ...c, dimName: dimension.name, optName: option.name });
    }
    if (option.sample) {
      samples.push({
        ...(option.sample as Sample),
        dimName: dimension.name,
        optName: option.name,
        layer: sampleLayer(dimension.id),
      });
    }
    if (option.ops?.length) {
      ops.push({ dimName: dimension.name, optName: option.name, items: option.ops });
    }
    if (option.env?.length) {
      for (const e of option.env) {
        env.push({ ...e, dimName: dimension.name, optName: option.name });
      }
    }
    if (option.notes?.length) {
      notes.push({ dimName: dimension.name, optName: option.name, items: option.notes });
    }
    if (option.pitfalls?.length) {
      pitfalls.push({ dimName: dimension.name, optName: option.name, items: option.pitfalls });
    }
  }

  return {
    dependencies: dedupeDeps(dependencies),
    properties,
    yamlBlocks,
    configClasses,
    samples,
    ops,
    env,
    notes,
    pitfalls,
    selected,
  };
}

/** 选型样例对应的代码层配色 */
function sampleLayer(dimId: string): CodeLayer {
  switch (dimId) {
    case 'persistence': return 'repo';
    case 'auth': return 'config';
    case 'cache': return 'service';
    case 'mq': return 'integration';
    case 'scheduler': return 'config';
    case 'migration': return 'sql';
    default: return 'config';
  }
}

// ─────────────────────────────────────────────────────────────
// 产物渲染
// ─────────────────────────────────────────────────────────────

/** 按维度分组渲染依赖，让 pom 里的注释说明「这个依赖是谁带来的」 */
function groupDeps(composed: ComposedStack) {
  const used = new Set<string>();
  const out: { dimName: string; optName: string; deps: Dependency[] }[] = [];

  for (const { dimension, option } of composed.selected) {
    const deps = (option.dependencies ?? []).filter((d) => {
      if (d.kind || !d.groupId || !d.artifactId) return false;
      const key = `${d.groupId}:${d.artifactId}`;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    });
    if (deps.length) {
      out.push({ dimName: dimension.name, optName: option.name, deps });
    }
  }
  // 未归入任何维度的兜底（理论上不会出现）
  const rest = composed.dependencies.filter(
    (d) => !used.has(`${d.groupId}:${d.artifactId}`)
  );
  if (rest.length) out.push({ dimName: '其他', optName: '', deps: rest });
  return out;
}

/** 生成完整可用的 pom.xml */
export function renderPom(
  composed: ComposedStack,
  artifactId = 'arsenal-demo',
  bootVersion = DEFAULT_BOOT_VERSION
): string {
  const groupsOfDeps = groupDeps(composed);
  const props = Object.entries(composed.properties);

  const propsBlock = props.length
    ? props.map(([k, v]) => `        <${k}>${v}</${k}>`).join('\n')
    : '        <java.version>17</java.version>';

  const depsBlock = groupsOfDeps
    .map(({ dimName, optName, deps }) => {
      const header = `        <!-- ── ${dimName}${optName ? ` · ${optName}` : ''} ${'─'.repeat(
        Math.max(2, 40 - dimName.length - optName.length)
      )} -->`;
      const body = deps
        .map((d) => {
          const lines = [
            '        <dependency>',
            `            <groupId>${d.groupId}</groupId>`,
            `            <artifactId>${d.artifactId}</artifactId>`,
          ];
          if (d.version) lines.push(`            <version>${d.version}</version>`);
          if (d.scope) lines.push(`            <scope>${d.scope}</scope>`);
          lines.push('        </dependency>');
          if (d.note) lines.push(`        <!-- ${d.note} -->`);
          return lines.join('\n');
        })
        .join('\n');
      return `${header}\n${body}`;
    })
    .join('\n\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  由「军火库 · 架构装配台」按当前组合生成。
  座右铭：业务依赖不写 <version>，版本交给 parent BOM 统一管理。
-->
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>${bootVersion}</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0.0</version>

    <properties>
${propsBlock}
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
${depsBlock}
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <!-- 保留参数名：Spring 参数名绑定、MyBatis 省略 @Param 都依赖它 -->
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <parameters>true</parameters>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

/**
 * 生成 application.yml：基础骨架 + 各选项贡献的片段。
 *
 * `appName` 默认取骨架自带的 artifactId；装配台传用户在 ① 项目定义里起的名字 ——
 * 导出包里的 `spring.application.name` 必须与 pom 的 artifactId 同名，
 * 否则注册中心与 K8s 里会出现两个名字指同一个服务。
 */
export function renderYaml(composed: ComposedStack, appName = 'arsenal-demo'): string {
  const head = `server:
  port: 8080
  shutdown: graceful

spring:
  application:
    name: ${appName}
  lifecycle:
    timeout-per-shutdown-phase: 30s
`;

  // 各选项的 yaml 块几乎都以顶层 `spring:` 开头。同一个 YAML 文档里出现重复的
  // 顶层键会被 Spring Boot 的 YAML 加载器直接拒绝（YamlProcessor 固定
  // allowDuplicateKeys=false），应用在解析配置那一步就起不来 —— 这正是导出包
  // 「解压即坏」的根因之一。用 `---` 分成多个文档：每个文档独立解析，
  // 后面的文档覆盖前面同键的配置，语义与 profile 覆盖一致，Spring 官方支持。
  const body = composed.yamlBlocks.length
    ? composed.yamlBlocks
        .map(
          (b) =>
            `# ────────────────────────────────────────────────────────\n` +
            `# ${b.dimName} · ${b.optName}\n` +
            `# ────────────────────────────────────────────────────────\n` +
            b.body
        )
        .join('\n---\n\n')
    : '# 当前组合没有额外需要声明的配置项。';

  const tail = `
# ────────────────────────────────────────────────────────
# 通用
# ────────────────────────────────────────────────────────
logging:
  level:
    root: INFO
    com.example: DEBUG
  pattern:
    console: "%d{HH:mm:ss.SSS} [%thread] [%X{traceId:-}] %-5level %logger{36} - %msg%n"
`;

  // 库名默认值跟随项目名：用户建一个与自己项目同名的库就能起，
  // 不必先弄懂 DB_NAME 再去查占位符语法。仅作用于带 `:app` 默认值的占位。
  return `${head}\n${body}\n${tail}`.split('${DB_NAME:app}').join(`\${DB_NAME:${appName}}`);
}

/** 生成给 AI 的选型约束 —— 这是「给 AI 用」出口在选型台的延伸 */
export function renderPrompt(composed: ComposedStack): string {
  const lines: string[] = [];
  lines.push('# 项目技术选型约束（必须严格遵守，不得自行替换或新增同类技术）');
  lines.push('');

  for (const g of groups) {
    const items = composed.selected.filter((s) => s.dimension.groupId === g.id);
    if (!items.length) continue;
    lines.push(`## ${g.name}`);
    for (const { dimension, option } of items) {
      lines.push(`- **${dimension.name}**：${option.name}（${option.id}）`);
    }
    lines.push('');
  }

  lines.push('## 硬性要求');
  lines.push('- 依赖版本一律由 spring-boot-starter-parent BOM 管理，业务依赖禁止手写 <version>。');
  lines.push('- 所有配置项按上方 application.yml 的键名书写，不得自行发明配置键。');
  lines.push('- 需要的配置类已在上方列出，请直接复用，不要重复定义同功能的 Bean。');
  lines.push('- 若某项技术未勾选（例如未选缓存、未选消息队列），代码中不得出现相关依赖与用法。');

  const pit = composed.pitfalls.flatMap((p) => p.items);
  if (pit.length) {
    lines.push('');
    lines.push('## 必须避免的错误写法');
    for (const p of pit.slice(0, 14)) lines.push(`- ${p}`);
  }

  return lines.join('\n');
}

/** 生成运维启动清单 */
export function renderOps(composed: ComposedStack): string[] {
  const out: string[] = [];
  for (const { dimension, option } of composed.selected) {
    for (const item of option.ops ?? []) out.push(item);
  }
  if (!out.length) return [];
  return out;
}

/** 统计当前组合的规模，用于概览条 */
export function stackScale(composed: ComposedStack) {
  const yamlLines = composed.yamlBlocks.reduce((n, b) => n + b.body.split('\n').length, 0);
  const configLines = composed.configClasses.reduce((n, c) => n + c.code.split('\n').length, 0);
  const sampleLines = composed.samples.reduce((n, s) => n + s.code.split('\n').length, 0);
  return {
    deps: composed.dependencies.length,
    yamlLines,
    configClasses: composed.configClasses.length,
    configLines,
    samples: composed.samples.length,
    sampleLines,
    notes: composed.notes.reduce((n, x) => n + x.items.length, 0),
    pitfalls: composed.pitfalls.reduce((n, x) => n + x.items.length, 0),
    ops: renderOps(composed).length,
    env: composed.env.length,
  };
}

/** 供导出用：把配置类拼成一个 Markdown */
export function renderConfigClassesMarkdown(composed: ComposedStack): string {
  if (!composed.configClasses.length) return '# 当前组合不需要额外的配置类';
  return composed.configClasses
    .map(
      (c) =>
        `## ${c.dimName} · ${c.optName}\n\n` +
        `**${c.className}** — \`${c.path}\`\n\n` +
        '```java\n' + c.code + '\n```'
    )
    .join('\n\n---\n\n');
}

export type { ConfigClass };
