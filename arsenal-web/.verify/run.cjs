/**
 * 校验引擎自检。
 *
 * 目的：证明「引擎确实能检出违规」，而不是只知道它能编译。
 * 做法：把 samples.ts 里刻意构造的违规代码喂给引擎，比对预期命中数。
 *
 * 运行：node .verify/run.cjs
 */
const fs = require('fs');
const path = require('path');
const { lint } = require('./engine.js');
const { SAMPLES } = require('./samples.js');

const rulesetPath = path.join(__dirname, '..', 'src', 'generated', 'rules.json');
const ruleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf8'));
const rules = ruleset.rules;

console.log('规则集：' + ruleset.meta.name + ' v' + ruleset.meta.version);
console.log('规则数：' + rules.length + '（active ' + rules.filter(r => r.status === 'active').length + '）');
console.log('带正则层：' + rules.filter(r => r.check && r.check.regex && r.check.regex.pattern).length);

let pass = 0;
let total = 0;
let allHitRules = new Set();

for (const s of SAMPLES) {
  total++;
  const report = lint([{ name: s.name, content: s.content }], rules);
  const ids = [...new Set(report.violations.map(v => v.ruleId))];
  ids.forEach(id => allHitRules.add(id));

  const ok = report.violations.length > 0;
  if (ok) pass++;

  console.log('\n──────────────────────────────────────────────');
  console.log(`样本  : ${s.label}  (${s.name})`);
  console.log(`预期  : ${s.expected} 处  实际 : ${report.violations.length} 处   涉及规则 ${ids.length} 条`);
  console.log(`评分  : ${report.score}/100 ${report.grade}   耗时 ${report.durationMs}ms   扫描 ${report.totalLines} 行`);
  console.log(`命中  : ${ids.join(', ')}`);
  console.log('明 细 :');
  for (const v of report.violations) {
    console.log(`  L${String(v.line).padStart(3)}:${String(v.column).padStart(2)}  [${v.severity.padEnd(6)}] ${v.ruleId.padEnd(17)} ${v.title.slice(0, 34)}`);
  }
  if (report.skipped.length) {
    console.log(`未覆盖: ${report.skipped.length} 条（需 AST / 语义判定）`);
  }
}

console.log('\n══════════════════════════════════════════════');
console.log(`样本检出：${pass}/${total} 个样本至少命中一条违规`);
console.log(`累计命中规则：${allHitRules.size} 条 → ${[...allHitRules].sort().join(', ')}`);

// 反向验证：一段写法规范的代码，不应该有 MUST/NEVER 级误报
const cleanCode = `package com.smarthub.controller;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/user")
    public ApiResponse<UserVO> create(@Valid @RequestBody CreateUserRequest req) {
        return ApiResponse.ok(userService.create(req));
    }
}
`;

const cleanReport = lint(
  [{ name: 'src/main/java/com/smarthub/controller/UserController.java', content: cleanCode }],
  rules
);
const blocking = cleanReport.violations.filter(v => v.severity === 'MUST' || v.severity === 'NEVER');
console.log('\n── 误报检查（规范写法）─────────────────────────');
console.log(`总分 ${cleanReport.score}/100   违规 ${cleanReport.violations.length} 处   其中强制级 ${blocking.length} 处`);
if (cleanReport.violations.length) {
  for (const v of cleanReport.violations) {
    console.log(`  L${v.line} [${v.severity}] ${v.ruleId}  ${v.title.slice(0, 40)}`);
  }
} else {
  console.log('  ✓ 零违规，无假阳性');
}
