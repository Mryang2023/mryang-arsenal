/**
 * 导出预检闸（export-lint）：对即将打进 zip 的文件清单做「包自洽性」终检。
 *
 * 为什么要有它：09-29 三轮导出事故的共性是九层 verify 全绿、产物照样起不来 ——
 * verify 检查的是「数据与规则的一致性」，没有任何一关检查「这份文件清单
 * 拼成的工程自身能不能编译、能不能启动」。同名 bean、重复文件、悬空 import、
 * 无版本依赖、异类片段混进 yml，这五类问题 zip 一打包就成了用户手里的
 * 「启动失败」，在台面上完全看不见。本闸在导出前把它们拦在台面。
 *
 * 每类检查都对应一次真实事故：
 *  ① duplicate-path  —— zip 对同名条目静默覆盖且无报错，目录树与包内容跟着分叉
 *  ② bean-conflict   —— securityjwt 事故：骨架与模块各有一份 JwtAuthenticationFilter
 *                       （@Component 简单类名相同）→ BeanDefinitionStoreException 启动即崩
 *  ③ dangling-import —— 被剔除的过滤器仍被 SecurityConfig import，编译第一步就红
 *  ④ pom-no-version  —— jacoco / nacos 事故：不在 Boot parent BOM 管辖的依赖必须
 *                       显式版本，否则 Maven 解析 pom 那一步直接报 version is missing
 *  ⑤ yml-foreign-root —— Dockerfile/Nginx/logback 片段混进 application.yml，
 *                        Spring 读到未知键静默丢弃，Nginx 片段则解析即崩
 *
 * 与 tools/build-content.py 的关系：其 build_project ⑦ 断言（SPRING_ROOTS）在
 * 构建期拦「数据源选项里的 yaml 片段」，本文件在导出期拦「最终产物」—— 两道
 * 闸互为镜像，YML_ROOT_WHITELIST 必须与那边同步维护。
 */
import type { ExportFile } from '@/lib/project';

export type LintCheck =
  | 'duplicate-path'
  | 'bean-conflict'
  | 'dangling-import'
  | 'pom-no-version'
  | 'yml-foreign-root';

export interface LintViolation {
  check: LintCheck;
  /** 人话详情：说什么坏了、坏在哪（自足，直接可展示） */
  message: string;
}

// ── 白名单（两处维护，改这里必须看 build-content.py 是否也要改）──

/**
 * spring-boot-dependencies（Boot parent 传递的 BOM）确定管辖的 groupId 前缀。
 * 这些依赖可以不写 <version>；**其余一律必须显式版本** —— 写显式版本永远
 * 不会错，顶多冗余；不写而 BOM 不管，Maven 解析即崩（nacos 事故）。
 *
 * 注意 org.springframework.cloud 故意不在名单：它有自己的 BOM，不在 Boot
 * parent 管辖内（scg 选项因此显式 4.1.1）。
 */
const BOM_MANAGED_PREFIXES = [
  'org.springframework.boot',
  'org.springframework', // framework / kafka / security 等子包；cloud 在下方显式排除
  'io.micrometer',
  'ch.qos.logback',
  'org.projectlombok',
  'org.junit',
  'org.mockito',
  'org.testcontainers',
  'org.flywaydb',
  'org.liquibase',
  'com.mysql',
  'org.postgresql',
  'com.github.ben-manes.caffeine',
  'org.apache.commons',
  'org.wiremock',
  'com.h2database',
];

/** 形似被前缀覆盖、实际不在 Boot BOM 内的 groupId —— 显式排除 */
const BOM_UNMANAGED = new Set(['org.springframework.cloud']);

/** <plugin> 无版本时的豁免：spring-boot-starter-parent 的 pluginManagement 管辖 */
const PLUGIN_MANAGED_PREFIXES = ['org.springframework.boot', 'org.apache.maven.plugins'];

/**
 * application.yml 顶层键白名单 —— 与 tools/build-content.py build_project ⑦
 * 的 SPRING_ROOTS 同步维护（那边拦数据源片段，这边拦最终产物）。
 */
const YML_ROOT_WHITELIST = new Set([
  'spring', 'server', 'mybatis-plus', 'springdoc', 'management', 'logging', 'app',
  'shardingsphere', 'xxl', 'xxl-job', 'xxljob', 'dubbo', 'redisson', 'resilience4j',
  'feign', 'rocketmq', 'kafka', 'elasticsearch', 'sentinel', 'seata', 'knife4j',
  'restclient', 'webflux', 'grpc', 'mqtt', 'minio', 'clickhouse', 'milvus',
  'wiremock', 'sonar', 'test', 'sa-token',
]);

function isBomManaged(groupId: string): boolean {
  if (BOM_UNMANAGED.has(groupId)) return false;
  return BOM_MANAGED_PREFIXES.some((p) => groupId === p || groupId.startsWith(p));
}

/** Gradle 侧同样要问「这个依赖无版本能不能解析」—— renderGradle 拼坐标时复用 */
export function needsExplicitVersion(groupId: string): boolean {
  return !isBomManaged(groupId);
}

// ── Java 文本处理 ──────────────────────────────────────────────

/** 去块注释与行注释（块注释按字符抹掉但保留换行，行结构不乱） */
function stripJavaComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

/** 直接标注这些注解的类，简单类名会注册为 bean —— 全包内必须唯一 */
const BEAN_ANNOTATIONS = new Set([
  'Component', 'Service', 'Repository', 'RestController', 'ControllerAdvice', 'Configuration',
]);

/**
 * 收集文件内「注册为 bean 的类名」。
 * 逐行找 class 声明，向上回溯连续注解行（遇到非注解语句即停，内部类
 * 因隔着一行 class 声明不会被外层注解误标）；注解与 class 同行也认。
 */
function collectBeanClasses(java: string): string[] {
  const lines = java.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/\bclass\s+(\w+)/);
    if (!m) continue;
    const before = lines[i].slice(0, m.index ?? 0);
    const sameLine = before.match(/@(\w+)/g) ?? [];
    if (sameLine.some((a) => BEAN_ANNOTATIONS.has(a.slice(1)))) {
      out.push(m[1]);
      continue;
    }
    let bean = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const t = lines[j].trim();
      if (!t) continue;
      if (t.startsWith('@')) {
        const name = t.match(/^@(\w+)/)?.[1];
        if (name && BEAN_ANNOTATIONS.has(name)) bean = true;
        continue;
      }
      break;
    }
    if (bean) out.push(m[1]);
  }
  return out;
}

function xmlTag(block: string, tag: string): string | undefined {
  return block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1].trim();
}

/**
 * 对导出清单做终检。**必须在 path 去重之后调用**（脚手架链路的模板版优先
 * 去重是既有设计；本检查兜底「去重逻辑失效或新增 push 忘记去重」）。
 */
export function lintExportFiles(files: ExportFile[]): LintViolation[] {
  const violations: LintViolation[] = [];

  // ① path 唯一性：zip 静默覆盖，重名文件后写的赢，谁也看不见
  const seenPath = new Map<string, number>();
  for (const f of files) seenPath.set(f.path, (seenPath.get(f.path) ?? 0) + 1);
  for (const [p, n] of seenPath) {
    if (n > 1) {
      violations.push({
        check: 'duplicate-path',
        message: `文件清单里有 ${n} 份「${p}」—— zip 会静默覆盖其中一份，目录树与包内容就此分叉。`,
      });
    }
  }

  // ②③ 源码检查：同名 bean 与悬空 import
  const javaPaths = new Set(files.filter((f) => f.path.endsWith('.java')).map((f) => f.path));
  const beanOwner = new Map<string, string>();
  for (const f of files) {
    if (!f.path.endsWith('.java')) continue;
    const src = stripJavaComments(f.content);

    for (const cls of collectBeanClasses(src)) {
      const prev = beanOwner.get(cls);
      if (prev) {
        violations.push({
          check: 'bean-conflict',
          message: `同名 bean「${cls}」同时来自 ${prev} 与 ${f.path} —— Spring 组件扫描按简单类名注册，启动即抛 BeanDefinitionStoreException。`,
        });
      } else {
        beanOwner.set(cls, f.path);
      }
    }

    for (const m of src.matchAll(/^import\s+(?!static\b)(com\.example\.[\w.]+);/gm)) {
      const fqn = m[1];
      if (fqn.endsWith('.*')) continue;
      const expected = `src/main/java/${fqn.replace(/\./g, '/')}.java`;
      if (!javaPaths.has(expected)) {
        violations.push({
          check: 'dangling-import',
          message: `${f.path} import 了包内不存在的 ${fqn}（预期落位 ${expected}）—— 编译第一步就红。`,
        });
      }
    }
  }

  // ④ pom 依赖/插件版本：BOM 管辖外必须显式版本
  const pom = files.find((f) => f.path === 'pom.xml');
  if (pom) {
    for (const m of pom.content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const block = m[1];
      const groupId = xmlTag(block, 'groupId');
      const artifactId = xmlTag(block, 'artifactId');
      if (!groupId || !artifactId || xmlTag(block, 'version')) continue;
      if (isBomManaged(groupId)) continue;
      violations.push({
        check: 'pom-no-version',
        message: `pom.xml 依赖 ${groupId}:${artifactId} 没有 <version> 且不在 spring-boot-dependencies BOM 管辖内 —— Maven 解析 pom 直接报 version is missing（nacos / jacoco 同族事故）。`,
      });
    }
    for (const m of pom.content.matchAll(/<plugin>([\s\S]*?)<\/plugin>/g)) {
      const block = m[1];
      const groupId = xmlTag(block, 'groupId');
      const artifactId = xmlTag(block, 'artifactId');
      if (!groupId || !artifactId || xmlTag(block, 'version')) continue;
      if (PLUGIN_MANAGED_PREFIXES.some((p) => groupId.startsWith(p))) continue;
      violations.push({
        check: 'pom-no-version',
        message: `pom.xml 构建插件 ${groupId}:${artifactId} 没有 <version> 且不在 parent pluginManagement 管辖内 —— Maven 解析即崩（jacoco 事故）。`,
      });
    }
  }

  // ⑤ application.yml 顶层键白名单：异类片段（Nginx/Dockerfile/logback…）
  //    混进来，轻则键被 Spring 静默丢弃，重则解析即崩
  for (const f of files) {
    if (!/^src\/main\/resources\/application(-[\w-]+)?\.yml$/.test(f.path)) continue;
    for (const line of f.content.split('\n')) {
      if (/^\s*(#|$)/.test(line) || line.startsWith('---')) continue;
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
      if (m && !YML_ROOT_WHITELIST.has(m[1])) {
        violations.push({
          check: 'yml-foreign-root',
          message: `${f.path} 顶层键「${m[1]}:」不是 Spring 配置 —— 某个选项的展示片段被误拼进了 application.yml（09-29 的 Nginx/Dockerfile 混入事故）。`,
        });
      }
    }
  }

  return violations;
}
