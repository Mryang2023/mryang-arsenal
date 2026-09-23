#!/usr/bin/env node
/**
 * gen-rule-schema.mjs —— 生成 `arsenal-rules/_schema/rule.schema.json`。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么 Schema 必须是生成物：
 *
 * 在这之前它是**手写**的，而全仓没有任何代码读它 —— 也就是说
 * 「字段定义的唯一真相」这句话当时是句空话：改坏它、少写一个枚举取值，
 * 不会有任何东西报错。这份 Schema 与 `scripts/sync-rules.mjs` 的校验逻辑、
 * 与 `RuleLoader.inspect` 的后端闸门，是三套互不相识的判断。
 *
 * 现在它由 `arsenal-rules/_schema/rule-contract.mjs` 一处算出：
 *
 *   枚举取值 / 必填性 / 字段类型 / 正则形态  ←─ rule-contract.mjs（唯一来源）
 *        ├─→ 本脚本 ─→ rule.schema.json（给人看、给外部工具用）
 *        └─→ scripts/lib/validate-rules.mjs ─→ npm run sync 的构建期硬失败
 *
 * 并且 `npm run sync` 会逐字节比对磁盘上的 Schema 与现算结果 ——
 * **手改生成的 Schema 会让构建当场失败**（不是靠人自觉）。
 *
 * ─────────────────────────────────────────────────────────────
 * 用法：
 *   node scripts/gen-rule-schema.mjs          # 写盘
 *   node scripts/gen-rule-schema.mjs --check  # 只比对不写盘；有差异 → exit 1
 */
import fs from 'node:fs';
import path from 'node:path';

import { RULE_SPEC } from '../../arsenal-rules/_schema/rule-contract.mjs';
import { SCHEMA_PATH, detectSchemaDrift, renderRuleSchema } from './lib/rule-schema.mjs';

const checkOnly = process.argv.includes('--check');
const rel = SCHEMA_PATH.replace(/\\/g, '/').replace(/^.*\/mryang-arsenal\//, '');

if (checkOnly) {
  const drift = detectSchemaDrift();
  if (drift === null) {
    console.log(`✅ ${rel} 与唯一来源一致`);
    process.exit(0);
  }
  console.error(`❌ ${rel} 已漂移：${drift}`);
  console.error('   处置：跑 `npm run gen:rule-schema` 重新生成（不要手改这个文件）');
  process.exit(1);
}

if (fs.existsSync(SCHEMA_PATH)) {
  const drift = detectSchemaDrift();
  if (drift === null) {
    console.log(`✅ ${rel} 已是最新，未改动`);
    process.exit(0);
  }
}

fs.mkdirSync(path.dirname(SCHEMA_PATH), { recursive: true });
fs.writeFileSync(SCHEMA_PATH, renderRuleSchema(), 'utf8');

const fieldCount = Object.keys(RULE_SPEC.fields).length;
console.log(`✅ 已生成 ${rel}`);
console.log(`   字段 ${fieldCount} 个 · 全部由 rule-contract.mjs 算出（含 description 与枚举取值）`);
