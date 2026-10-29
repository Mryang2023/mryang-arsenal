#!/usr/bin/env node
/**
 * verify:rules —— 规则溯源报告（重建设计计划 §6.1，夜班 N9/2026-10-30）。
 *
 * 回答一个问题：**69 条规则里，多少条的出处经得起核对？**
 *
 * 「完整」的口径（与重建设计计划 §6.1 一致）：
 *   1. sources 至少一条；
 *   2. 每条来源都带引文（quote）—— 没有引文的引用无法核对；
 *   3. 行业手册类引用必须有版次与章节号 —— 「阿里巴巴Java开发手册」有嵩山/泰山等多个版次，
 *      只写书名等于没写（基线实测：51 处阿里引用只有 1 处带版次）。
 *
 * 诚实口径：本脚本**如实报告**基线（2026-10-29 实测为 15/69），退出码 0 ——
 * 它是「体检报告」，不是「拦截闸」；跑 `--strict` 才按「有缺即 1」拦截。
 * 数字全部实时从语料计算，不写死常量 —— 语料修好，这里的数字自然上去。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const rulesDir = path.resolve(here, '..', '..', 'arsenal-rules');
const strict = process.argv.includes('--strict');

const SKIP_FILES = new Set(['meta.json', 'mcp-tools.json']);
const SKIP_DIRS = new Set(['_schema']);

/** 阿里手册引用必须有版次（嵩山/泰山/终极/第X版）——只写书名无法对应到可核对的文本。 */
const EDITION_RE = /(嵩山|泰山|终极|华山|黄山|第[一二三四五六七八九十\d]+版)/;
/** 必须有章节定位（§x / 第X章 / x.x / 「一、」式小节）。 */
const CLAUSE_RE = /(§|第[一二三四五六七八九十\d]+[章节条]|[一二三四五六七八九十]+、|\d+\.\d+)/;

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
    } else if (name.endsWith('.json') && !SKIP_FILES.has(name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(rulesDir, []);
const rules = [];
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(f, 'utf-8'));
  for (const r of doc.rules ?? []) rules.push({ rule: r, file: path.relative(rulesDir, f) });
}

const problems = [];
for (const { rule, file } of rules) {
  const srcs = rule.sources ?? [];
  if (srcs.length === 0) {
    problems.push(`${rule.id}（${file}）无出处`);
    continue;
  }
  for (const s of srcs) {
    const ref = s.ref ?? '';
    if (!s.quote) problems.push(`${rule.id}（${file}）来源「${ref}」缺引文`);
    if (ref.includes('阿里巴巴')) {
      if (!EDITION_RE.test(ref)) problems.push(`${rule.id}（${file}）阿里引用「${ref}」缺版次`);
      if (!CLAUSE_RE.test(ref)) problems.push(`${rule.id}（${file}）阿里引用「${ref}」缺章节号`);
    }
  }
}

const full = rules.length - new Set(problems.map((p) => p.split('（')[0])).size;
const pct = rules.length ? Math.round((full / rules.length) * 100) : 0;

console.log('\n【规则溯源报告】arsenal-rules 实时计算，非写死常量');
console.log(`规则总数 ${rules.length} · 出处完整 ${full} · 完整率 ${pct}%`);
console.log('完整口径：每条来源带引文；阿里手册引用带版次+章节号');
if (problems.length) {
  console.log(`\n缺口清单（${problems.length} 处）：`);
  for (const p of problems) console.log('  - ' + p);
} else {
  console.log('\n无缺口。');
}
console.log('\n退出码：' + (strict && problems.length ? 1 : 0) + (strict ? '（--strict：有缺即 1）' : '（报告口径）'));
process.exit(strict && problems.length ? 1 : 0);
