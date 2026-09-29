/**
 * 脚手架生成链路自检（verify:scaffold）。
 *
 * 守的是「选型 → 三包」这条新链路的三类坑：
 *   ① 模板仓库 ↔ 打进 bundle 的清单不一致（改了 arsenal-scaffold 忘跑 sync）；
 *  ② 生成的 Java 代码 import 了 pom 里不存在的第三方（选型声明跟不上模板）；
 *  ③ 占位符越权（模板里出现白名单之外的 {{...}}，渲染结果不可预期）；
 *  ④ module.json 清单字段残缺（模块卡片与生成器读不到要的键）；
 *  ⑤ 三包组装冒烟（全模块组合必须产出后端/前端/全家桶且关键文件在场）。
 *
 * 跑法：npx tsx .verify/scaffold-check.ts（或 npm run verify:scaffold）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { SCAFFOLD_FILES, SCAFFOLD_MODULES } from '@/generated/scaffold-templates';
import { defaultPicks } from '@/lib/stack';
import type { StackPicks } from '@/lib/content-types';
import { buildExportArtifacts } from '@/lib/scaffold/artifacts';
import { resolveModules } from '@/lib/scaffold/module-registry';
import { findIllegalPlaceholders } from '@/lib/scaffold/render';
import { check, finish } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const scaffoldDir = path.resolve(here, '..', '..', 'arsenal-scaffold');

// ── ① 模板目录 ↔ bundle 清单 ─────────────────────────────────
{
  console.log('\n【1】模板目录 ↔ SCAFFOLD_FILES 一致');
  const onDisk = new Set<string>();
  const walk = (dir: string, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const key = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, key);
      else onDisk.add(key);
    }
  };
  walk(scaffoldDir);
  onDisk.delete('modules/user/module.json');
  onDisk.delete('modules/role/module.json');
  onDisk.delete('modules/menu/module.json');
  const bundled = new Set(Object.keys(SCAFFOLD_FILES));
  const missing = [...onDisk].filter((k) => !bundled.has(k));
  const extra = [...bundled].filter((k) => !onDisk.has(k));
  check('arsenal-scaffold 目录与生成产物逐文件一致（多/少都算漂移）',
    missing.length === 0 && extra.length === 0,
    `缺: ${missing.slice(0, 3).join(', ')} | 多: ${extra.slice(0, 3).join(', ')}`);
  check('三个模块清单打进 bundle（module.json → SCAFFOLD_MODULES）',
    ['user', 'role', 'menu'].every((id) => id in SCAFFOLD_MODULES));
}

// ── ② 生成代码 import ↔ pom GAV ──────────────────────────────
{
  console.log('\n【2】生成 Java 的第三方 import ↔ pom 依赖');
  const picks = { ...defaultPicks, persistence: 'mybatisplus', database: 'mysql',
    migration: 'flyway', auth: 'custom' } as StackPicks;
  const { selected } = resolveModules(['user', 'role', 'menu'], picks, 'vue3-vite');
  const vars = {
    basePackage: 'com.example', basePackagePath: 'com/example', artifactId: 'demo',
    appName: 'demo', backendBaseUrl: 'http://127.0.0.1:8080', dbImage: 'mysql:8.0.36',
  };
  const artifacts = buildExportArtifacts(picks, {
    projectName: 'demo', env: { values: {}, demoMode: false }, modules: selected, feBase: 'vue3-vite', vars,
  });
  const pom = artifacts.backend.files.find((f) => f.path === 'pom.xml')?.content ?? '';

  // import 前缀 → 可接受的 artifactId（任一在 pom 即算覆盖；传递依赖写伞形 starter）
  const GAV_MAP: [string, string[]][] = [
    ['com.baomidou.mybatisplus', ['mybatis-plus-spring-boot3-starter']],
    ['org.mybatis.spring', ['mybatis-plus-spring-boot3-starter']],
    ['org.apache.ibatis', ['mybatis-plus-spring-boot3-starter']],
    ['io.jsonwebtoken', ['jjwt-api']],
    ['org.springframework.security.crypto', ['spring-security-crypto', 'spring-boot-starter-security']],
    ['org.springframework.data.jpa', ['spring-boot-starter-data-jpa']],
    ['jakarta.persistence', ['spring-boot-starter-data-jpa']],
    ['jakarta.validation', ['spring-boot-starter-validation']],
    ['org.springframework.data.redis', ['spring-boot-starter-data-redis']],
    ['org.aspectj', ['spring-boot-starter-aop']],
    ['io.micrometer', ['micrometer-registry-prometheus']],
    ['org.flywaydb', ['flyway-core']],
    ['com.github.benmanes.caffeine', ['caffeine']],
    ['net.javacrumbs.shedlock', ['shedlock-spring']],
    ['io.swagger.v3', ['springdoc-openapi-starter-webmvc-ui']],
  ];
  const SKIP_PREFIXES = ['java.', 'javax.', 'jakarta.servlet.', 'com.example.', 'org.springframework.',
    'jakarta.annotation.', 'com.fasterxml.jackson.', 'org.slf4j.', 'org.junit.', 'org.mockito.', 'org.hamcrest.'];

  const unknown = new Map<string, string>();
  for (const f of artifacts.backend.files) {
    if (!f.path.endsWith('.java') || !f.path.startsWith('src/')) continue;
    for (const m of f.content.matchAll(/^\s*import\s+(?:static\s+)?([a-zA-Z0-9_.]+);/gm)) {
      const fqn = m[1];
      if (SKIP_PREFIXES.some((p) => fqn.startsWith(p))) continue;
      const hit = GAV_MAP.find(([prefix]) => fqn.startsWith(prefix));
      if (!hit) {
        unknown.set(fqn, f.path);
        continue;
      }
      if (!hit[1].some((a) => pom.includes(a))) unknown.set(`${fqn} (缺 ${hit[1].join('|')})`, f.path);
    }
  }
  check('全模块组合：Java 第三方 import 全部有 pom 依赖兜底（零悬空）',
    unknown.size === 0,
    [...unknown.entries()].slice(0, 4).map(([k, v]) => `${k} @ ${v}`).join('；') || '');
  check('全模块组合：后端包产出迁移与种子（V1 追加模块表 + V2__seed.sql）',
    artifacts.backend.files.some((f) => f.path.endsWith('V1__init.sql') && f.content.includes('sys_user')) &&
      artifacts.backend.files.some((f) => f.path.endsWith('V2__seed.sql')));
  check('全模块组合：仓储实现只装选中持久层的那一叉',
    artifacts.backend.files.some((f) => f.path.includes('repository/mp/')) &&
      !artifacts.backend.files.some((f) => f.path.includes('repository/jpa/')));
}

// ── ③ 前端 import ↔ package.json ─────────────────────────────
{
  console.log('\n【3】前端模板 import ↔ package.json');
  const pkgRaw = SCAFFOLD_FILES['frontend/vue3-vite/package.json.tpl'];
  const deps = new Set<string>();
  const pkg = JSON.parse(pkgRaw) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
  for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);

  const bad: string[] = [];
  for (const [key, content] of Object.entries(SCAFFOLD_FILES)) {
    if (!key.startsWith('frontend/vue3-vite/src/')) continue;
    for (const m of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const src = m[1];
      if (src.startsWith('.') || src.startsWith('@/')) continue;
      const pkgName = src.startsWith('@') ? src.split('/').slice(0, 2).join('/') : src.split('/')[0];
      if (!deps.has(pkgName)) bad.push(`${pkgName} @ ${key}`);
    }
  }
  check('前端模板的外部 import 全部在 package.json 里（零悬空）',
    bad.length === 0, [...new Set(bad)].slice(0, 4).join('；') || '');
}

// ── ④ module.json 字段契约 ───────────────────────────────────
{
  console.log('\n【4】module.json 必填字段');
  const REQUIRED = ['id', 'name', 'description', 'requires', 'tables', 'endpoints', 'menus', 'backendFiles'] as const;
  const problems: string[] = [];
  for (const [id, def] of Object.entries(SCAFFOLD_MODULES)) {
    const m = def as Record<string, unknown>;
    for (const key of REQUIRED) {
      if (m[key] === undefined) problems.push(`${id} 缺 ${key}`);
    }
    if ((m.requires as string[])?.includes(id)) problems.push(`${id} 自依赖`);
  }
  check('模块清单九字段齐备且不自依赖', problems.length === 0, problems.join('；') || '');
}

// ── ⑤ 占位符越权扫描 ─────────────────────────────────────────
{
  console.log('\n【5】占位符白名单');
  const illegal: string[] = [];
  for (const [key, content] of Object.entries(SCAFFOLD_FILES)) {
    // .vue 的 Vue 插值与占位符同形，跳过（渲染器本就是白名单替换，见 render.ts 头注）
    if (key.endsWith('.vue.tpl')) continue;
    for (const name of findIllegalPlaceholders(content)) {
      illegal.push(`${name} @ ${key}`);
    }
  }
  check('非 .vue 模板零越权占位符', illegal.length === 0, illegal.slice(0, 4).join('；') || '');
}

// ── ⑥ 三包组装冒烟 ───────────────────────────────────────────
{
  console.log('\n【6】三包组装冒烟');
  const picks = { ...defaultPicks, persistence: 'mybatisplus', database: 'mysql',
    migration: 'flyway', auth: 'securityjwt' } as StackPicks;
  const { selected } = resolveModules(['user', 'role', 'menu'], picks, 'vue3-vite');
  const vars = {
    basePackage: 'com.example', basePackagePath: 'com/example', artifactId: 'demo',
    appName: 'demo', backendBaseUrl: 'http://127.0.0.1:8080', dbImage: 'mysql:8.0.36',
  };
  const arts = buildExportArtifacts(picks, {
    projectName: 'demo', env: { values: {}, demoMode: true }, modules: selected, feBase: 'vue3-vite', vars,
  });
  const allPaths = new Set(arts.all.files.map((f) => f.path));
  check('全家桶含编排/初始化 SQL/启动脚本/README',
    ['compose/docker-compose.yml', 'sql/mysql/V1__init.sql', 'scripts/start-dev.sh', 'README.md']
      .every((p) => allPaths.has(p)));
  check('演示档：application-demo.yml 与 h2 依赖随包产出',
    arts.backend.files.some((f) => f.path.endsWith('application-demo.yml')) &&
      (arts.backend.files.find((f) => f.path === 'pom.xml')?.content.includes('com.h2database') ?? false));
  // 动态变体的标志是守卫的 dynamic 开关（注册动作在守卫里按需 import）
  check('双变体：勾菜单模块时 index.ts 由动态变体充当',
    arts.frontend!.files.some((f) => f.path === 'src/router/index.ts' && f.content.includes('dynamic: true')) &&
      arts.frontend!.files.some((f) => f.path === 'src/router/dynamic-routes.ts'));
  check('feBase=none 时不出前端包',
    buildExportArtifacts(picks, {
      projectName: 'demo', env: { values: {}, demoMode: false }, modules: [], feBase: 'none', vars,
    }).frontend === undefined);
  check('环境烘焙：填了连接信息后主 yml 默认值被替换',
    buildExportArtifacts(picks, {
      projectName: 'demo',
      env: { values: { 'db.host': '10.0.0.5', 'db.username': 'app' }, demoMode: false },
      modules: [], feBase: 'none', vars,
    }).backend.files.find((f) => f.path.endsWith('application.yml'))!.content.includes('${DB_HOST:10.0.0.5}'));
}

process.exit(finish('scaffold'));
