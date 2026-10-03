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
import { lintExportFiles } from '@/lib/export-lint';
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
    ['jakarta.persistence', ['spring-boot-starter-data-jpa', 'jakarta.persistence-api']],
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
  console.log('\n【3】前端模板 import ↔ package.json（逐套模板自洽）');
  // 多套 UI 模板（2026-10-03）：模板根 = frontend/<base>/<template>/，
  // 从 bundle key 动态发现，不再硬编码单一目录 —— 新增模板后这里自动多测一套。
  const templateRoots = new Set<string>();
  for (const key of Object.keys(SCAFFOLD_FILES)) {
    const m = /^frontend\/[^/]+\/([^/]+)\/package\.json\.tpl$/.exec(key);
    if (m) templateRoots.add(key.slice(0, key.length - 'package.json.tpl'.length));
  }

  const bad: string[] = [];
  for (const root of templateRoots) {
    const pkgRaw = SCAFFOLD_FILES[`${root}package.json.tpl`];
    const deps = new Set<string>();
    const pkg = JSON.parse(pkgRaw) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const k of Object.keys(pkg.dependencies ?? {})) deps.add(k);
    for (const k of Object.keys(pkg.devDependencies ?? {})) deps.add(k);
    for (const [key, content] of Object.entries(SCAFFOLD_FILES)) {
      if (!key.startsWith(`${root}src/`)) continue;
      for (const m of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const src = m[1];
        if (src.startsWith('.') || src.startsWith('@/')) continue;
        const pkgName = src.startsWith('@') ? src.split('/').slice(0, 2).join('/') : src.split('/')[0];
        if (!deps.has(pkgName)) bad.push(`${pkgName} @ ${key}`);
      }
    }
  }
  check(`前端模板的外部 import 全部在各自 package.json 里（零悬空 · ${templateRoots.size} 套模板）`,
    templateRoots.size > 0 && bad.length === 0,
    templateRoots.size === 0 ? '没发现任何模板目录 —— 迁移或 sync 断了' : [...new Set(bad)].slice(0, 4).join('；') || '');
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

// ── ⑦ 导出预检闸（export-lint）────────────────────────────────
// 09-29 三轮导出事故的系统性防线：同名 bean / 重复文件 / 悬空 import /
// 无版本依赖 / yml 异类键，任何一类出现都拒绝导出。断言反着验：先验
// 事故同款组合零违规，再注入五类毒物确认全被拦。
{
  console.log('\n【7】导出预检闸');
  const stackJson = JSON.parse(
    fs.readFileSync(path.resolve(here, '..', 'src', 'generated', 'stack.json'), 'utf-8'),
  ) as { dimensions: { id: string; defaultOption?: string }[] };
  const picks: Record<string, string> = {};
  for (const d of stackJson.dimensions) if (d.defaultOption) picks[d.id] = d.defaultOption;
  picks['auth'] = 'securityjwt';
  picks['secret'] = 'configcenter';
  picks['qualitygate'] = 'jacoco';

  const vars = {
    basePackage: 'com.example', basePackagePath: 'com/example', artifactId: 'demo',
    appName: 'demo', backendBaseUrl: 'http://127.0.0.1:8080', dbImage: 'mysql:8.0.36',
  };
  const arts = buildExportArtifacts(picks as StackPicks, {
    projectName: 'demo', env: { values: {}, demoMode: false }, modules: [], feBase: 'none', vars,
  });
  check('事故同款组合（securityjwt+configcenter+jacoco）：后端包零违规',
    arts.violations.length === 0, arts.violations.map((v) => v.message).join('；').slice(0, 200));

  // 接管回归：main 侧骨架三件被剔除后，test 侧 @MockBean 目标必须跟着指向模块版
  const testFile = arts.backend.files.find((f) => f.path.endsWith('UserControllerTest.java'));
  check('securityjwt 接管：切片测试的 AuthInterceptor import 指向模块版（无骨架悬空引用）',
    !!testFile && testFile.content.includes('import com.example.auth.web.AuthInterceptor;')
      && !testFile.content.includes('import com.example.interceptor.AuthInterceptor;'));

  const pom = arts.backend.files.find((f) => f.path === 'pom.xml')?.content ?? '';
  check('nacos / jacoco 均带显式版本（BOM 外必须显式）',
    /<version>2023\.0\.1\.3<\/version>/.test(pom) &&
      /jacoco-maven-plugin[\s\S]{0,200}?<version>0\.8\.11<\/version>/.test(pom));

  // 五类注入反验：每一类毒物都必须命中对应检查
  const bad = [
    { path: 'src/main/java/com/example/a/Dup.java', content: '@Component\npublic class Dup {\n}\n', group: '源码' },
    { path: 'src/main/java/com/example/b/Dup2.java', content: '// @Component class NotBean {}\n@Service\npublic class Dup {\n}\n', group: '源码' },
    { path: 'src/main/java/com/example/c/Uses.java', content: 'import com.example.missing.Ghost;\nimport static com.example.a.Dup.x;\nimport com.example.a.*;\npublic class Uses {\n}\n', group: '源码' },
    { path: 'pom.xml', content: '<dependency><groupId>io.minio</groupId><artifactId>minio</artifactId></dependency><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency><build><plugins><plugin><groupId>org.pitest</groupId><artifactId>pitest-maven</artifactId></plugin></plugins></build>', group: '构建' },
    { path: 'src/main/resources/application.yml', content: 'spring:\n  application:\n    name: demo\nnginx:\n  worker_processes: 1\n', group: '配置' },
    { path: 'a.txt', content: 'x', group: '文档' },
    { path: 'a.txt', content: 'y', group: '文档' },
  ] as const;
  const lint = lintExportFiles(bad as never);
  const checks = new Set(lint.map((v) => v.check));
  check('五类毒物注入全被拦（同名 bean/悬空 import/无版本/yml 异类键/重复 path）',
    checks.size === 5
      && lint.some((v) => v.check === 'bean-conflict' && v.message.includes('Dup') && !v.message.includes('NotBean'))
      && lint.some((v) => v.check === 'dangling-import' && v.message.includes('Ghost'))
      && lint.filter((v) => v.check === 'pom-no-version').length === 2 // minio 无版本 + pitest-maven 插件无版本；boot starter 不误报
      && lint.some((v) => v.check === 'yml-foreign-root' && v.message.includes('nginx'))
      && lint.some((v) => v.check === 'duplicate-path'),
    `命中 ${[...checks].join(',')}（${lint.length} 条）`);
}

process.exit(finish('scaffold'));
