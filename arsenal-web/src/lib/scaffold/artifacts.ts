/**
 * 三包组装：backend.zip / frontend.zip / all.zip。
 * all.zip 的目录布局与 compose 模板的相对路径强耦合：
 *   backend/  frontend/  compose/  sql/{mysql,postgres}/  scripts/  README.md
 * 改布局必须连 compose 与 start 脚本里的 context 路径一起改。
 */
import type { ExportFile } from '@/lib/project';
import { buildExportPlan } from '@/lib/project';
import { lintExportFiles } from '@/lib/export-lint';
import { auditArchitecture } from '@/lib/arch';
import type { StackPicks } from '@/lib/content-types';
import { SCAFFOLD_FILES } from '@/generated/scaffold-templates';
import type { EnvInput, ExportArtifacts, ExportArtifact, ModuleDef, TemplateVars } from './contracts';
import { buildBackendFiles } from './backend-plan';
import { buildFrontendFiles } from './frontend-plan';
import { renderPath, renderText } from './render';
import { defaultTemplateOf } from './env-form';

function artifact(name: string, files: ExportFile[]): ExportArtifact {
  const bytes = files.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0);
  return { name, files, bytes };
}

function prefixFiles(files: ExportFile[], prefix: string): ExportFile[] {
  return files.map((f) => ({ ...f, path: `${prefix}/${f.path}` }));
}

/** postgres 选型时把 compose 的 MySQL 段换成 PostgreSQL 段（模板里两者成对给出） */
function swapComposeDialect(compose: string): string {
  return compose
    .replace(
      `      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: {{appName}}
      TZ: Asia/Shanghai`,
      `      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: root
      POSTGRES_DB: {{appName}}
      TZ: Asia/Shanghai`,
    )
    .replace('      - "3306:3306"', '      - "5432:5432"')
    .replace('- db-data:/var/lib/mysql', '- db-data:/var/lib/postgresql/data')
    .replace('- ./../sql/mysql:/docker-entrypoint-initdb.d:ro', '- ./../sql/postgres:/docker-entrypoint-initdb.d:ro')
    .replace('mysqladmin ping -h 127.0.0.1 -uroot -proot', 'pg_isready -U postgres')
    .replace('SPRING_DATASOURCE_URL: jdbc:mysql://db:3306/{{appName}}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true', 'SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/{{appName}}')
    .replace('SPRING_DATASOURCE_USERNAME: root', 'SPRING_DATASOURCE_USERNAME: postgres');
}

function sharedFile(key: string, vars: TemplateVars): string {
  const raw = SCAFFOLD_FILES[key] ?? '';
  return renderText(raw, vars);
}

export function buildExportArtifacts(
  picks: StackPicks,
  opts: {
    projectName: string;
    baseId?: string;
    env: EnvInput;
    modules: ModuleDef[];
    feBase: string;
    /** 前端 UI 模板 id（vue3-vite 基底下：element-admin / naive-admin / element-topbar） */
    feUi?: string;
    vars: TemplateVars;
  },
): ExportArtifacts {
  const { projectName, env, modules, feBase, vars } = opts;
  // feUi 未传（旧调用方 / 摘要路径）时落回该基底的 default 模板 —— 行为与多模板化之前一致
  const feUi = opts.feUi ?? defaultTemplateOf(feBase);
  const audit = auditArchitecture(picks);

  // ── 后端包 ─────────────────────────────────────────────────
  const backendFiles = buildBackendFiles(picks, audit, {
    projectName,
    env,
    modules,
    vars,
    baseId: opts.baseId,
  });
  const kind = picks.build === 'gradle' ? 'gradle' : 'maven';
  const backend = artifact(`${projectName}-backend.zip`, backendFiles);

  // ── 前端包（feBase=none 或 react 规划中时不出）──────────────
  // feUi 是同一基底下的 UI 模板选择；模板目录不存在时 buildFrontendFiles
  // 如实返回 null，按「没有前端包」处理，不静默回落到别的模板
  let frontend: ExportArtifact | undefined;
  if (feBase === 'vue3-vite') {
    const feFiles = buildFrontendFiles({
      vars,
      withMenuModule: modules.some((m) => m.id === 'menu'),
      baseId: feBase,
      templateId: feUi,
    });
    if (feFiles) frontend = artifact(`${projectName}-frontend.zip`, feFiles);
  }

  // ── 全家桶 ─────────────────────────────────────────────────
  const allFiles: ExportFile[] = [];
  allFiles.push(...prefixFiles(backendFiles, 'backend'));
  if (frontend) allFiles.push(...prefixFiles(frontend.files, 'frontend'));

  for (const key of [
    'shared/compose/docker-compose.yml.tpl',
    'shared/compose/frontend.Dockerfile.tpl',
    'shared/compose/frontend-nginx.conf.tpl',
    'shared/compose/backend.Dockerfile.tpl',
    'shared/scripts/start-dev.sh.tpl',
    'shared/scripts/start-dev.bat.tpl',
  ]) {
    const rel = key.replace('shared/', '').replace(/\.tpl$/, '');
    allFiles.push({ path: rel, content: sharedFile(key, vars), group: '部署', from: '全家桶编排' });
  }

  // db 容器首次启动的初始化目录：两个方言都给，compose 按选型挂载对应目录
  const dialect = picks.database === 'postgres' ? 'postgres' : 'mysql';
  for (const name of ['V1__init.sql', 'V2__seed.sql']) {
    const raw = SCAFFOLD_FILES[`shared/sql/${dialect}/${name}.tpl`] ?? '';
    const content = renderText(raw, vars);
    if (content.trim()) {
      allFiles.push({ path: `sql/${dialect}/${name}`, content, group: '数据', from: '功能模块 · 建表与种子' });
    }
  }

  const compose = allFiles.find((f) => f.path === 'compose/docker-compose.yml');
  if (compose && picks.database === 'postgres') {
    compose.content = swapComposeDialect(compose.content);
  }

  const readmeAll = sharedFile('shared/README-all.md.tpl', vars);
  if (readmeAll.trim()) {
    allFiles.push({ path: 'README.md', content: readmeAll, group: '文档', from: '全家桶启动指南' });
  }

  const all = artifact(`${projectName}-all.zip`, allFiles);
  // 导出预检闸：后端包清单终检。违规 ≠ 抛异常（useMemo 里抛会崩页面），
  // 而是带回去让交付面板禁用下载、在台面亮清单 —— 问题看得见，包拿不走。
  const violations = lintExportFiles(backendFiles);
  return { backend, frontend, all, violations };
}

/** 交付页只需要 plan 的场景（渐进接入期兼容旧调用） */
export function buildLegacyPlan(picks: StackPicks, projectName: string, baseId?: string) {
  return buildExportPlan(picks, auditArchitecture(picks), baseId, projectName);
}
