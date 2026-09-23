/**
 * rule-schema.mjs —— 由**契约唯一来源**算出 `rule.schema.json` 的正文。
 *
 * 为什么单独一个模块：两处要用同一份结果，而**必须**是同一份 ——
 *   · `scripts/gen-rule-schema.mjs`（CLI）—— 写盘 / `--check`
 *   · `scripts/sync-rules.mjs`         —— 构建期防漂移比对，不让手改的 Schema 混过去
 * 各写一份渲染逻辑，就会出现「生成器算的和闸门比的不一样」这种荒诞故障。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { RULE_SPEC, SCHEMA_DIALECT, SCHEMA_ID, assertContractIntegrity } from '../../../arsenal-rules/_schema/rule-contract.mjs';
import { toJsonSchema } from './spec-validate.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(webRoot, '..');

/** 生成的 Schema 落点。 */
export const SCHEMA_PATH = path.join(repoRoot, 'arsenal-rules', '_schema', 'rule.schema.json');

/**
 * 渲染 Schema 正文（**含结尾换行**）。
 *
 * 键顺序在这里定死，保证同一份契约每次产出**逐字节相同** —— 防漂移闸门比的是字节，
 * 顺序一飘，闸门就会误报「有人手改」。
 */
export function renderRuleSchema() {
  // 先自检：契约自己坏了的话，生成出来的 Schema 是错得很安静的那种错
  assertContractIntegrity();
  const body = toJsonSchema(RULE_SPEC);
  const schema = {
    $schema: SCHEMA_DIALECT,
    $id: SCHEMA_ID,
    title: RULE_SPEC.title,
    description: RULE_SPEC.description,
    type: body.type,
    required: body.required,
    additionalProperties: body.additionalProperties,
    properties: body.properties,
  };
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/** 磁盘上的正文；文件不存在返回 null（不是空串 —— 两者含义不同）。 */
export function readOnDiskSchema() {
  try {
    return fs.readFileSync(SCHEMA_PATH, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 防漂移比对。返回 `null` 表示一致，否则返回一句可以直接进构建报错的原因。
 *
 * 抽成函数而不是各写一段 if：`--check` 与 `sync` 的判据必须**逐字相同**。
 */
export function detectSchemaDrift() {
  const onDisk = readOnDiskSchema();
  if (onDisk === null) {
    return 'rule.schema.json 不存在 —— 它是生成物，跑 `npm run gen:rule-schema` 生成';
  }
  const expected = renderRuleSchema();
  if (onDisk === expected) return null;

  // 只报「第几行不同」，不打印全文 —— 全文差异在终端里没法读
  const a = onDisk.split('\n');
  const b = expected.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return (
        `rule.schema.json 与唯一来源（arsenal-rules/_schema/rule-contract.mjs）不一致，` +
        `首个不同在第 ${i + 1} 行：\n` +
        `        磁盘上：${a[i] === undefined ? '（没有这一行）' : a[i].trim()}\n` +
        `        来源算：${b[i] === undefined ? '（没有这一行）' : b[i].trim()}`
      );
    }
  }
  return 'rule.schema.json 与唯一来源不一致（行尾差异）';
}
