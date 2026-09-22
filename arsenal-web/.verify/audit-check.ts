/**
 * 架构可运行性校验 —— 自检。
 *
 * 为什么需要这个：这套判定的全部价值在于「说不能跑的时候，原因真的是对的」。
 * 编译通过完全不能说明这一点。下面每个用例都对应一种真实会让项目起不来的情况，
 * 结论必须与人工判断一致，且不能出现重复报错（同一个原因报两条会让人开始不信报告）。
 *
 * 跑法：npx tsx .verify/audit-check.ts
 */
import { auditArchitecture, nodeArch, skeletonPicks } from '@/lib/arch';
import { emptyPicks, presetPicks } from '@/lib/stack';
import type { StackPicks } from '@/lib/content-types';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
// 见 .verify/lib/report.ts 顶部注释。
import { check, finish } from './lib/report';

function titles(list: { title: string }[]) {
  return list.map((x) => x.title).join(' | ');
}

const std = presetPicks('standard');

// ── ① 空画布：一块都没装 ──────────────────────────────────
console.log('\n【1】空画布（一块都没装）');
const a1 = auditArchitecture(emptyPicks());
check('判定为「跑不起来」', a1.status === 'broken', a1.status);
check(
  '报出 5 个必需模块缺失',
  a1.blockers.length === 5,
  `实际 ${a1.blockers.length}：${titles(a1.blockers)}`
);
check('已装配数为 0', a1.stats.filled === 0);
check('提供的能力为空', a1.providedCaps.length === 0);
check('所有槽位状态都不为 filled', Object.values(a1.slotStates).every((s) => s !== 'filled'));

// ── ② 只留必选：能跑的最小骨架 ────────────────────────────
console.log('\n【2】只留必选（最小可运行骨架）');
const a2 = auditArchitecture(skeletonPicks());
check('必选项全齐 5/5', a2.stats.requiredFilled === 5 && a2.stats.requiredTotal === 5,
  `${a2.stats.requiredFilled}/${a2.stats.requiredTotal}`);
check('没有阻塞项', a2.blockers.length === 0, titles(a2.blockers));
check('能力需求全部被满足', a2.unmetCaps.length === 0, a2.unmetCaps.join(','));
check('判定为「能跑，但零件不全」', a2.status === 'incomplete', a2.status);
check('列出了建议补齐的件', a2.gaps.length > 0, `gaps=${a2.gaps.length}`);
check('判据是必选项——不是随便报错', a2.gaps.every((g) => g.dim !== 'jdk' && g.dim !== 'web'));

// ── ③ 生产标配：应当判定为可运行 ──────────────────────────
console.log('\n【3】生产标配预设');
const a3 = auditArchitecture(std);
check('判定为「可以跑起来」', a3.status === 'runnable', titles([...a3.blockers, ...a3.risks]));
check('无阻塞项', a3.blockers.length === 0, titles(a3.blockers));
// 生产标配用了 Spring @Scheduled，会命中「默认单调度线程」这条隐患 —— 这是对的。
// 断言的重点因此不是「没有风险」，而是**报出来的风险必须写清了现象**：
// 报一条说不出会看到什么的风险，和没报没有区别，还会消耗掉对整份报告的信任。
check(
  '报出的风险项都写了触发条件与可核对现象',
  a3.risks.every((g) => !!g.trigger && (g.symptoms?.length ?? 0) >= 2),
  titles(a3.risks.filter((g) => !g.trigger || (g.symptoms?.length ?? 0) < 2))
);
check(
  '风险项不会把结论拉低成「跑不起来或零件不全」',
  a3.status === 'runnable',
  a3.status
);
check('提供的能力数 >= 20', a3.providedCaps.length >= 20, String(a3.providedCaps.length));
check(
  '所有槽位都处于 filled / conflict',
  Object.values(a3.slotStates).every((s) => s === 'filled' || s === 'conflict'),
  JSON.stringify(a3.slotStates)
);

// ── ④ 拆掉数据库：归并检查，这是最容易报重复的一处 ────────
console.log('\n【4】从生产标配里拆掉「数据库」');
const a4 = auditArchitecture({ ...std, database: '' });
check('判定为「跑不起来」', a4.status === 'broken', a4.status);
const dbGap = a4.blockers.find((b) => b.dim === 'database');
check('报出「缺少数据库」', !!dbGap, titles(a4.blockers));
check('槽位状态标为 missing-required', a4.slotStates.database === 'missing-required',
  a4.slotStates.database);
check(
  '下游能力缺口被归并成「后果」，而不是另开一条',
  !a4.blockers.some((b) => b.title.includes('无人提供')),
  titles(a4.blockers)
);
check(
  '归并项写清了谁因此拿不到什么',
  (dbGap?.consequences?.length ?? 0) > 0,
  JSON.stringify(dbGap?.consequences)
);

// ── ⑤ 能力缺口：没有节点空缺，但能力没人提供 ──────────────
console.log('\n【5】持久层在、数据库缺，且无节点级空缺可归并');
const a5 = auditArchitecture({ ...std, database: '', persistence: 'jpa' });
check('仍然判定为跑不起来', a5.status === 'broken');
check('结论条数不超过 2（1 个缺件 + 归并后果）', a5.blockers.length <= 2, titles(a5.blockers));

// ── ⑥ 响应式 + 阻塞持久层：架构自相矛盾 ───────────────────
console.log('\n【6】WebFlux + MyBatis-Plus');
const a6 = auditArchitecture({ ...std, web: 'webflux', persistence: 'mybatisplus' });
check('判定为「跑不起来」', a6.status === 'broken', a6.status);
check('命中架构冲突策略', a6.blockers.some((b) => b.title.includes('响应式')), titles(a6.blockers));
check('冲突策略标红了 web 与 persistence',
  a6.slotStates.web === 'conflict' && a6.slotStates.persistence === 'conflict',
  `${a6.slotStates.web}/${a6.slotStates.persistence}`);

// ── ⑦ 多实例 + 本地缓存：能跑，但会出事 ───────────────────
console.log('\n【7】Caffeine + Nacos（多实例）');
const a7 = auditArchitecture({ ...std, cache: 'caffeine', registry: 'nacos' });
check('不是「跑不起来」——它确实能启动', a7.status !== 'broken', a7.status);
check('报为风险项', a7.risks.some((r) => r.title.includes('进程内缓存')), titles(a7.risks));
check('cache 槽位标为有隐患', a7.slotStates.cache === 'conflict', a7.slotStates.cache);

// ── ⑧ 自研鉴权 ────────────────────────────────────────────
console.log('\n【8】自研鉴权');
const a8 = auditArchitecture({ ...std, auth: 'custom' });
check('报为风险项', a8.risks.some((r) => r.title.includes('自研')), titles(a8.risks));

// ── ⑨ 空规则不能误伤：留空的可选项不产生阻塞 ──────────────
console.log('\n【9】把所有可选项拆空');
const onlyRequired: StackPicks = { ...std };
for (const [dim, node] of Object.entries(nodeArch)) {
  if (!node.required) onlyRequired[dim] = '';
}
const a9 = auditArchitecture(onlyRequired);
check('只剩必选项时没有阻塞', a9.blockers.length === 0, titles(a9.blockers));
check('不产生「无人提供」的假报错', a9.unmetCaps.length === 0, a9.unmetCaps.join(','));
check('但会提示缺建议件', a9.gaps.length > 0, `gaps=${a9.gaps.length}`);

// ── ⑩ 单调性：装零件不会让结论变差 ────────────────────────
console.log('\n【10】逐步装配的单调性');
let prev = 0;
let monotonic = true;
const acc: StackPicks = emptyPicks();
for (const [dim, node] of Object.entries(nodeArch)) {
  if (!node.required) continue;
  acc[dim] = std[dim] || '';
}
for (const [dim, opt] of Object.entries(std)) {
  acc[dim] = opt;
  const s = auditArchitecture({ ...acc }).providedCaps.length;
  if (s < prev) monotonic = false;
  prev = s;
}
check('能力总数随装配只增不减', monotonic);

finish('arch');
