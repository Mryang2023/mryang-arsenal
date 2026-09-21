/**
 * 校验引擎自检 —— 第三层。
 *
 * 目的：证明「引擎确实能检出违规」，而不是只知道它能编译。
 * 做法：把 samples.ts 里刻意构造的违规代码喂给引擎，**比对预期命中数**。
 *
 * ─────────────────────────────────────────────────────────────
 * 两条教训，写在这里防止重犯：
 *
 * ① 这个脚本必须能失败。
 *    上一版（run.cjs）全文没有退出码，也从不拿实测命中数比 samples.ts 里的 expected，
 *    只断言 `> 0`。结果：30 条正则全废也照样「全绿」，
 *    而 samples.ts 里那句「实测值，由自检脚本核对」的核对从来没发生过。
 *    凡是「只打印不断言」的地方，都是等你踩坑的地方。
 *
 * ② 这个脚本必须测源码，不能测产物。
 *    上一版读的是 `.verify/engine.js`、`.verify/samples.js` —— 手工转译的副本。
 *    那对副本真的漂移过：expected 在 `.ts` 里是 9/5/3/4/2，在 `.js` 里是 11/6/2/4/1，
 *    5 条全部对不上，而内容字符串一模一样。副本没有生成机制，也没有守门。
 *    现在直接 import `src/lib/*.ts`，漂移在结构上不可能发生。
 *
 * 跑法：npx tsx .verify/run.ts      （或 npm run verify:engine）
 * ─────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { lint } from '@/lib/engine';
import { SAMPLES } from '@/lib/samples';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const rulesetPath = path.join(here, '..', 'src', 'generated', 'rules.json');
const ruleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf8'));
const rules = ruleset.rules;

/**
 * 基线：这些数字变了就要有人确认「是预期内的变化」，而不是顺手改大。
 *
 * 它们全都来自一次真实运行，不是估计值。改动引擎或规则之后如果这里红了，
 * 先回答「引擎少检出了什么」再决定改数字。
 */
const BASELINE = {
  /** 至少要被命中的规则条数 —— 这是引擎检出能力的下限，跌下来就是正则失效 */
  hitRules: 24,
  /** 写法规范的样本允许出现的违规数。0 是硬要求：假阳性会让人不再信报告 */
  cleanViolations: 0,
};

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ''}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 【1】规则池的口径必须自洽
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】规则池');
console.log(`  规则集：${ruleset.meta.name} v${ruleset.meta.version}`);

const activeCount = rules.filter((r: { status?: string }) => r.status === 'active').length;
const withPattern = rules.filter(
  (r: { check?: { regex?: { pattern?: string } } }) => !!r.check?.regex?.pattern
).length;

check(`规则总数与 active 数一致（共 ${rules.length} 条）`, activeCount === rules.length,
  `active ${activeCount} / 共 ${rules.length}`);
check(`带正则层的规则 ${withPattern} 条`, withPattern === 35, `实际 ${withPattern}`);

// ═══════════════════════════════════════════════════════════════
// 【2】每个样本的实际命中数必须等于 samples.ts 里标注的 expected
// ═══════════════════════════════════════════════════════════════
console.log('\n【2】样本检出（实测 vs 标注）');

const allHitRules = new Set<string>();

for (const s of SAMPLES) {
  const report = lint([{ name: s.name, content: s.content }], rules);
  const ids = [...new Set(report.violations.map((v) => v.ruleId))];
  ids.forEach((id) => allHitRules.add(id));

  const actual = report.violations.length;
  console.log('\n──────────────────────────────────────────────');
  console.log(`样本  : ${s.label}  (${s.name})`);
  console.log(`预期  : ${s.expected} 处  实际 : ${actual} 处   涉及规则 ${ids.length} 条`);
  console.log(`评分  : ${report.score}/100 ${report.grade}   耗时 ${report.durationMs}ms   扫描 ${report.totalLines} 行`);
  console.log(`命中  : ${ids.join(', ')}`);
  console.log('明 细 :');
  for (const v of report.violations) {
    console.log(
      `  L${String(v.line).padStart(3)}:${String(v.column).padStart(2)}  ` +
      `[${v.severity.padEnd(6)}] ${v.ruleId.padEnd(17)} ${v.title.slice(0, 34)}`
    );
  }
  if (report.skipped.length) {
    console.log(`未覆盖: ${report.skipped.length} 条（需 AST / 语义判定）`);
  }

  check(`${s.key}：实测 ${actual} 处 == 标注 ${s.expected} 处`, actual === s.expected,
    actual > s.expected ? '实测更多 —— 有规则重复报或规则改动后没更新标注'
      : '实测更少 —— 有正则失效了，这是最危险的一种红');
}

console.log(`\n累计命中规则：${allHitRules.size} 条 → ${[...allHitRules].sort().join(', ')}`);
check(
  `命中规则不少于 ${BASELINE.hitRules} 条（引擎检出能力下限）`,
  allHitRules.size >= BASELINE.hitRules,
  `实际 ${allHitRules.size} 条`
);

// ═══════════════════════════════════════════════════════════════
// 【3】没有「悄悄消失」的规则：每条 active 规则要么被执行，要么被如实披露
// ═══════════════════════════════════════════════════════════════
console.log('\n【3】规则去账');
const probe = lint([{ name: SAMPLES[0].name, content: SAMPLES[0].content }], rules);
const brokenRegex = probe.skipped.filter((s) => s.layer === 'regex');

check(
  '不存在「正则无法编译」的规则（有的话是规则缺陷）',
  brokenRegex.length === 0,
  brokenRegex.map((s) => s.ruleId).join('、')
);
check(
  `规则去账平衡：执行 ${probe.executableRules} + 披露 ${probe.skipped.length} == 池子 ${probe.rulePool}`,
  probe.executableRules + probe.skipped.length === probe.rulePool,
  `${probe.executableRules} + ${probe.skipped.length} != ${probe.rulePool}`
);
check(
  '披露的规则都写清了「为什么检不了」',
  probe.skipped.every((s) => !!s.reason && s.reason.length >= 6),
  probe.skipped.find((s) => !s.reason || s.reason.length < 6)?.ruleId ?? ''
);
check(
  '未覆盖的层只可能是 ast / llm / manual，不会出现「正则层却没跑」',
  probe.skipped.every((s) => s.layer === 'ast' || s.layer === 'llm' || s.layer === 'manual')
);

// ═══════════════════════════════════════════════════════════════
// 【4】反向验证：写法规范的代码必须零误报
// ═══════════════════════════════════════════════════════════════
console.log('\n【4】误报检查（规范写法）');

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
const blocking = cleanReport.violations.filter((v) => v.severity === 'MUST' || v.severity === 'NEVER');

console.log(`  总分 ${cleanReport.score}/100   违规 ${cleanReport.violations.length} 处   其中强制级 ${blocking.length} 处`);
for (const v of cleanReport.violations) {
  console.log(`  L${v.line} [${v.severity}] ${v.ruleId}  ${v.title.slice(0, 40)}`);
}

check('规范写法不产生 MUST / NEVER 误报', blocking.length === 0,
  blocking.map((v) => `${v.ruleId}@L${v.line}`).join('、'));
check(
  `规范写法的违规数 == ${BASELINE.cleanViolations}`,
  cleanReport.violations.length === BASELINE.cleanViolations,
  cleanReport.violations.length === 0
    ? ''
    : '这是假阳性。要改的是规则或这个样本，不是这条断言'
);

/**
 * 编排清单单独再验一次。
 *
 * 容器那组规则里有两条是 `expect: "present"`（缺字段即违规），
 * 这类断言最容易翻车的地方不是漏报，而是**报文本身**：
 * 只要 targetGlob 稍微宽一点，configmap、helm values 就会一起被要求带 resources，
 * 那就会变成每次校验都报一堆假阳性 —— 报一次假阳性的代价，是之后所有报告都没人看。
 */
const cleanDeploy = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: smarthub-api
spec:
  replicas: 3
  template:
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: api
          image: registry.local/smarthub-api:2.3.0
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: prod
          resources:
            requests:
              cpu: "500m"
              memory: 768Mi
            limits:
              cpu: "2"
              memory: 1Gi
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
`;

const cleanLogback = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
    </appender>
    <root level="INFO">
        <appender-ref ref="STDOUT"/>
    </root>
</configuration>
`;

const cleanCtnrReport = lint(
  [
    { name: 'deploy/k8s/04-deployment.yaml', content: cleanDeploy },
    { name: 'src/main/resources/logback-spring.xml', content: cleanLogback },
  ],
  rules
);
console.log(`\n  规范编排清单：违规 ${cleanCtnrReport.violations.length} 处`);
for (const v of cleanCtnrReport.violations) {
  console.log(`  L${v.line} [${v.severity}] ${v.ruleId}  ${v.title.slice(0, 40)}`);
}
check(
  '规范编排清单零违规（present 型断言最容易在这里翻车）',
  cleanCtnrReport.violations.length === 0,
  cleanCtnrReport.violations.map((v) => `${v.ruleId}@L${v.line}`).join('、')
);

// ═══════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(56)}`);
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log(`累计命中规则 ${allHitRules.size} 条（基线 ${BASELINE.hitRules}）`);
process.exitCode = fail === 0 ? 0 : 1;
