/**
 * 后端包生成：在既有 collectExportFiles（选型装配、48 文件基线、九层 verify 守着）
 * 之上叠加「环境烘焙 + 认证基础设施 + 功能模块 + SQL 合并 + 演示档」。
 *
 * 环境值烘焙的方式是改占位符默认值：`${DB_HOST:127.0.0.1}` → `${DB_HOST:用户填的}`。
 * 保留 ${ENV:默认} 形态，用户填的值是默认、环境变量仍可覆盖 —— 比另造一个
 * local profile 少一套激活语义，prod yml 的纯环境变量注入不受影响。
 */
import type { ExportFile } from '@/lib/project';
import { collectExportFiles } from '@/lib/project';
import type { ArchAudit } from '@/lib/arch';
import type { StackPicks } from '@/lib/content-types';
import { SCAFFOLD_FILES } from '@/generated/scaffold-templates';
import type { EnvInput, EnvValues, ModuleDef, TemplateVars } from './contracts';
import { renderPath, renderText } from './render';
import { moduleDdl, moduleSeed } from './sql-plan';

/** 环境值 key → application.yml 里的占位符名 */
const ENV_TO_PLACEHOLDER: Record<string, string> = {
  'db.host': 'DB_HOST',
  'db.port': 'DB_PORT',
  'db.name': 'DB_NAME',
  'db.username': 'DB_USERNAME',
  'db.password': 'DB_PASSWORD',
  'redis.host': 'REDIS_HOST',
  'redis.port': 'REDIS_PORT',
  'redis.password': 'REDIS_PASSWORD',
  'nacos.addr': 'NACOS_ADDR',
  'nacos.username': 'NACOS_USER',
  'nacos.password': 'NACOS_PASSWORD',
};

/** 把用户填的连接信息烘进主 yml 的占位符默认值 */
function bakeEnv(yml: string, env: EnvInput): string {
  let out = yml;
  for (const [key, name] of Object.entries(ENV_TO_PLACEHOLDER)) {
    const value = env.values[key];
    if (value === undefined || value === '') continue;
    out = out.replace(new RegExp(`\\$\\{${name}:[^}]*\\}`), `\${${name}:${value}}`);
  }
  return out;
}

/** 演示档：H2 内存库。Flyway/sql.init 在 H2 MODE=MySQL 上照常工作，只换数据源 */
const DEMO_YML = `# 演示档：H2 内存库，零外部依赖起服务（--spring.profiles.active=demo）。
# 登录与 CRUD 演示够用；数据重启即清，且部分 MySQL 方言行为有差异，不能当生产参照。
spring:
  datasource:
    url: jdbc:h2:mem:demo;MODE=MySQL;CASE_INSENSITIVE_IDENTIFIERS=TRUE;DB_CLOSE_DELAY=-1
    driver-class-name: org.h2.Driver
    username: sa
    password: ""
`;

/** 仓储实现目录按持久层二选一（repository/jpa/** 与 repository/mp/**） */
function persistenceFits(persistence: string | undefined, relPath: string): boolean {
  if (relPath.includes('/repository/jpa/')) return persistence === 'jpa';
  if (relPath.includes('/repository/mp/')) return persistence === 'mybatisplus';
  return true;
}

function collectTemplates(
  prefix: string,
  files: Record<string, string>,
  vars: TemplateVars,
  persistence: string | undefined,
  group: ExportFile['group'],
  from: string,
  out: ExportFile[],
) {
  for (const [key, content] of Object.entries(files)) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!persistenceFits(persistence, rel)) continue;
    out.push({
      path: renderPath(rel, vars),
      content: renderText(content, vars),
      group,
      from,
    });
  }
}

export function buildBackendFiles(
  picks: StackPicks,
  audit: ArchAudit,
  opts: {
    projectName: string;
    env: EnvInput;
    modules: ModuleDef[];
    vars: TemplateVars;
    baseId?: string;
  },
): ExportFile[] {
  const { projectName, env, modules, vars } = opts;
  const files = collectExportFiles(picks, audit, opts.baseId, projectName);

  // ── 环境烘焙（只动 application.yml；prod 保持纯 ${ENV_VAR}）──────
  for (const f of files) {
    if (f.path.endsWith('application.yml')) f.content = bakeEnv(f.content, env);
  }

  const persistence = picks.persistence;

  // ── 认证基础设施（自研 JWT，custom / securityjwt 两选型共用）────
  // 前缀切到「模块根」而不是它的 src/ 之后 —— 模板 key 里的 src/main/... 必须保留，
  // 否则文件落到工程根外面，mvn 根本编不到（E2E 实测抓过这个坑）
  if (picks.auth === 'custom' || picks.auth === 'securityjwt') {
    collectTemplates(
      'backend/auth/',
      SCAFFOLD_FILES,
      vars,
      persistence,
      '源码',
      '认证基础设施',
      files,
    );
  }

  // ── MyBatis-Plus 分页插件配置 ─────────────────────────────────
  if (persistence === 'mybatisplus') {
    collectTemplates(
      'backend/mybatis/',
      SCAFFOLD_FILES,
      vars,
      persistence,
      '源码',
      '持久层 · MyBatis-Plus',
      files,
    );
  }

  // ── 功能模块（module-registry 已做过依赖闭包与冲突警告）────────
  for (const mod of modules) {
    collectTemplates(
      `modules/${mod.id}/`,
      SCAFFOLD_FILES,
      vars,
      persistence,
      '源码',
      `功能模块 · ${mod.name}`,
      files,
    );
  }

  // ── 勾了 mod-user 时剔除旧示例 user 领域：两者都在 com.example 顶层
  // 声明 GET /api/users，Spring 启动即因 ambiguous mapping 拒绝 —— 模块版
  // （system.user，sys_user 表）是全量替代品，示例的「照它抄」职责由它接手。
  if (modules.some((m) => m.id === 'user')) {
    for (let i = files.length - 1; i >= 0; i -= 1) {
      const p = files[i].path;
      if (p.startsWith('src/main/java/com/example/user/')
        || p.startsWith('src/test/java/com/example/user/')
        || p === 'src/main/resources/mapper/UserMapper.xml'
        // 示例定时任务依赖被剔除的示例 UserService —— 跟着一起剔除
        || p.endsWith('job/UserSyncJob.java')) {
        files.splice(i, 1);
      }
    }
  }

  // ── SQL 合并：模块建表/种子并入选型带来的迁移文件 ─────────────
  if (modules.length > 0) {
    const ddl = moduleDdl(picks.database);
    const seed = moduleSeed(picks.database, modules.map((m) => m.id));
    const section = '\n-- ════════ 以下由脚手架功能模块追加 ════════\n\n';
    if (picks.migration === 'flyway') {
      for (const f of files) {
        if (f.path.endsWith('db/migration/V1__init.sql')) f.content += section + ddl;
      }
      if (seed) {
        files.push({
          path: 'src/main/resources/db/migration/V2__seed.sql',
          content: seed,
          group: '数据',
          from: '功能模块 · 种子数据',
        });
      }
    } else if (picks.migration === 'none') {
      for (const f of files) {
        if (f.path.endsWith('db/schema.sql')) f.content += section + ddl + '\n' + seed;
      }
    }
    // liquibase：changelog 是 XML 索引，不追加；组合冲突由 module-registry 警告
  }

  // ── 演示档 ──────────────────────────────────────────────────
  if (env.demoMode) {
    files.push({ path: 'src/main/resources/application-demo.yml', content: DEMO_YML, group: '配置', from: '演示模式' });
    const pom = files.find((f) => f.path === 'pom.xml');
    if (pom && !pom.content.includes('com.h2database')) {
      pom.content = pom.content.replace(
        '</dependencies>',
        `        <!-- 演示档数据源（--spring.profiles.active=demo 时生效） -->\n`
        + `        <dependency>\n            <groupId>com.h2database</groupId>\n            <artifactId>h2</artifactId>\n            <scope>runtime</scope>\n        </dependency>\n    </dependencies>`,
      );
    }
  }

  // ── mybatisplus + 模块：实体模板同时带 JPA 注解（单实体双叉共用），
  // 编译期需要 jakarta.persistence-api；纯 MP 路径下这些注解运行时是惰性的
  if (modules.length > 0 && persistence === 'mybatisplus') {
    const pom = files.find((f) => f.path === 'pom.xml');
    if (pom && !pom.content.includes('jakarta.persistence-api')) {
      pom.content = pom.content.replace(
        '</dependencies>',
        `        <!-- 模块实体同时标注 JPA 注解（单实体双叉共用），编译期需要它；\n`
        + `             纯 MyBatis-Plus 运行时路径不触碰这些注解 -->\n`
        + `        <dependency>\n            <groupId>jakarta.persistence</groupId>\n            <artifactId>jakarta.persistence-api</artifactId>\n            <version>3.1.0</version>\n        </dependency>\n    </dependencies>`,
      );
    }
  }

  return files;
}

/** 环境值里值得在交付页展示的键（密码打码由 UI 层做） */
export function envSummary(values: EnvValues): { key: string; value: string }[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}
