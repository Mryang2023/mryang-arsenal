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
  if (picks.auth === 'custom' || picks.auth === 'securityjwt') {
    collectTemplates(
      'backend/auth/src/',
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
      'backend/mybatis/src/',
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
      `modules/${mod.id}/src/`,
      SCAFFOLD_FILES,
      vars,
      persistence,
      '源码',
      `功能模块 · ${mod.name}`,
      files,
    );
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

  return files;
}

/** 环境值里值得在交付页展示的键（密码打码由 UI 层做） */
export function envSummary(values: EnvValues): { key: string; value: string }[] {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}
