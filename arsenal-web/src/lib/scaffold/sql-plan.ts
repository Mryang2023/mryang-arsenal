/**
 * SQL 装配：模块建表与种子并入选型带来的迁移文件。
 *
 * 规则（与 shared/sql 种子文件头注释一致）：
 *  - 方言按 database 选型取 mysql / postgres 目录；
 *  - 种子按 [SECTION:*] 标记裁剪：core 恒留、permission 随 role、menu 随 menu 模块；
 *  - flyway：模块 DDL 追加进 V1__init.sql，种子单独成 V2__seed.sql；
 *  - migration=none：DDL 与种子都追加进 db/schema.sql（sql.init 每次启动执行，靠幂等）；
 *  - liquibase：不走追加（changelog 是 XML 索引），交给 module-registry 出警告。
 */
import { SCAFFOLD_FILES } from '@/generated/scaffold-templates';

const SECTIONS = ['core', 'permission', 'menu'] as const;
type SectionName = (typeof SECTIONS)[number];

function dialectOf(database: string | undefined): 'mysql' | 'postgres' {
  return database === 'postgres' ? 'postgres' : 'mysql';
}

/** 按模块勾选裁剪种子段落 */
export function trimSeed(raw: string, moduleIds: string[]): string {
  const keep = new Set<SectionName>(['core']);
  if (moduleIds.includes('role')) keep.add('permission');
  if (moduleIds.includes('menu')) keep.add('menu');

  const out: string[] = [];
  let current: SectionName | null = null;
  for (const line of raw.split('\n')) {
    const m = /^--\s*=====\s*\[SECTION:([a-z]+)\]\s*=====\s*$/.exec(line.trim());
    if (m && (SECTIONS as readonly string[]).includes(m[1])) {
      current = m[1] as SectionName;
      continue;
    }
    if (current === null || keep.has(current)) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function moduleDdl(database: string | undefined): string {
  const key = `shared/sql/${dialectOf(database)}/V1__init.sql.tpl`;
  return SCAFFOLD_FILES[key] ?? '';
}

export function moduleSeed(database: string | undefined, moduleIds: string[]): string {
  const key = `shared/sql/${dialectOf(database)}/V2__seed.sql.tpl`;
  const raw = SCAFFOLD_FILES[key] ?? '';
  if (!raw || moduleIds.length === 0) return '';
  return trimSeed(raw, moduleIds);
}
