import type {
  ArchLink,
  ArchNode,
  CaseDef,
  CaseParams,
  CasePlan,
  CaseSlice,
  DecisionSummary,
  InactiveSlice,
  SlicePlan,
} from './case-types';

/**
 * 场景合成引擎：**(场景, 参数) → 方案**。
 *
 * 照 composeStack 的三条精神写，一条都不能少：
 *
 *   1. **纯函数**。不读时间、不读随机、不发请求。同参数两次调用结果逐字节相等
 *      （.verify/case-check.ts 会断言这件事）。
 *   2. **缺省不是静默跳过**。切片没命中必须进 inactiveSlices 并给出可核对的原因 ——
 *      「该切片要求 数据规模 ∈ {1亿,10亿,100亿}，当前 1000万」。
 *      静默省略会让读者以为「这个参数下不需要做这件事」，而真相可能是「不能做」。
 *   3. **不猜**。architecture 的节点只能来自场景数据，引擎里不许硬编码任何节点。
 */

/** 归一化参数：补上缺失的驱动（取第一档），丢掉场景里不存在的键 */
export function normalizeParams(kase: CaseDef, params: CaseParams): CaseParams {
  const out: CaseParams = {};
  // 按 drivers 的声明顺序遍历 —— 顺序写死，输出才可复现
  for (const d of kase.drivers) {
    const v = params?.[d.id];
    out[d.id] = v && d.levels.some((l) => l.id === v) ? v : d.levels[0]?.id ?? '';
  }
  return out;
}

/** when 是否命中：列出的每个 driver 的当前档位都必须在其允许列表里 */
function whenHits(when: Record<string, string[]> | undefined, params: CaseParams): boolean {
  if (!when) return true;
  for (const [did, levels] of Object.entries(when)) {
    if (!levels || levels.length === 0) continue;
    if (!levels.includes(params[did])) return false;
  }
  return true;
}

/**
 * 把 when 翻成人话。
 *
 * 之所以要写这个函数：原因必须**可核对**。
 * 只说「不适用」的读者无法判断是自己参数选错了，还是这条切片本来就用不上。
 */
function describeWhen(kase: CaseDef, when: Record<string, string[]>): string {
  const parts: string[] = [];
  for (const [did, levels] of Object.entries(when)) {
    const d = kase.drivers.find((x) => x.id === did);
    if (!d) continue;
    const labels = levels.map(
      (lv) => d.levels.find((l) => l.id === lv)?.label ?? lv
    );
    parts.push(`${d.name} ∈ {${labels.join('、')}}`);
  }
  return parts.join(' 且 ');
}

function currentSummary(kase: CaseDef, params: CaseParams, driverIds: string[]): string {
  return driverIds
    .map((did) => {
      const d = kase.drivers.find((x) => x.id === did);
      if (!d) return '';
      const cur = d.levels.find((l) => l.id === params[did]);
      return `${d.name} ${cur?.label ?? params[did]}`;
    })
    .filter(Boolean)
    .join(' · ');
}

/** 参数化后的建议架构。节点过滤 + 孤儿连线清理，两端缺一就整条去掉 */
function buildArchitecture(
  kase: CaseDef,
  params: CaseParams
): { nodes: ArchNode[]; links: ArchLink[] } {
  const nodes = (kase.architecture?.nodes ?? []).filter(
    (n) => !n.whenAny || whenHits(n.whenAny, params)
  );
  const ids = new Set(nodes.map((n) => n.id));
  const links = (kase.architecture?.links ?? []).filter(
    (l) => ids.has(l.from) && ids.has(l.to)
  );
  return { nodes, links };
}

export function synthCase(kase: CaseDef, rawParams: CaseParams): CasePlan {
  const params = normalizeParams(kase, rawParams);

  const activeSlices: SlicePlan[] = [];
  const inactiveSlices: InactiveSlice[] = [];

  for (const slice of kase.slices ?? []) {
    const when = slice.when ?? {};
    if (whenHits(when, params)) {
      const matched = Object.keys(when).flatMap((did) => {
        const d = kase.drivers.find((x) => x.id === did);
        if (!d) return [];
        const cur = d.levels.find((l) => l.id === params[did]);
        return cur ? [{ driverId: did, driverName: d.name, levelLabel: cur.label }] : [];
      });
      activeSlices.push({ slice, matched });
    } else {
      // 只报真正没满足的那几个驱动 —— 全量罗列会让人抓不住重点
      const failed = Object.entries(when).filter(
        ([did, levels]) => levels.length > 0 && !levels.includes(params[did])
      );
      const want = describeWhen(kase, when);
      const got = currentSummary(
        kase,
        params,
        failed.map(([did]) => did)
      );
      inactiveSlices.push({
        slice,
        reason: `该切片要求 ${want}，当前 ${got} —— 在这个参数下做了属于过度设计，故不给出代码。`,
      });
    }
  }

  const warnings: string[] = [];
  for (const c of kase.conflicts ?? []) {
    if (whenHits(c.when, params)) warnings.push(c.text);
  }
  for (const n of kase.notSuitableFor ?? []) {
    if (whenHits(n.when, params)) warnings.push(`本场景不适合当前参数：${n.reason}`);
  }

  const decisions: DecisionSummary[] = activeSlices.map(({ slice }) => ({
    sliceId: slice.id,
    sliceGoal: slice.goal,
    question: slice.decision.question,
    chosen: slice.decision.chosen,
    tradeoff: slice.decision.tradeoff,
  }));

  // 顺序写死的去重：先按切片顺序收集，再用 Set 去重，最后排序 —— 保证可复现
  const ruleSet = new Set<string>();
  for (const { slice } of activeSlices) {
    for (const r of slice.relatedRules ?? []) ruleSet.add(r);
    for (const h of slice.highlights ?? []) if (h.rule) ruleSet.add(h.rule);
  }

  return {
    kase,
    params,
    warnings,
    activeSlices,
    inactiveSlices,
    decisions,
    rules: [...ruleSet].sort(),
    architecture: buildArchitecture(kase, params),
  };
}

/** 参数组合空间的笛卡尔积。断言要穷举，就必须能枚举 —— 上限用于防止组合数爆炸 */
export function enumerateParams(kase: CaseDef, limit = 5000): CaseParams[] {
  const dims = kase.drivers.map((d) => d.levels.map((l) => l.id));
  let total = 1;
  for (const d of dims) total *= Math.max(1, d.length);
  if (total > limit) return [];

  let acc: CaseParams[] = [{}];
  kase.drivers.forEach((d, i) => {
    const next: CaseParams[] = [];
    for (const base of acc) {
      for (const lv of dims[i]) next.push({ ...base, [d.id]: lv });
    }
    acc = next;
  });
  return acc;
}

/**
 * 每个驱动取 min / max 两档的笛卡尔积 + 额外采样。
 *
 * 组合数太大时用它替代全穷举：min/max 组合能覆盖「每条 when 的两端」，
 * 足以验证 active + inactive === 总数 这条守恒律不被破坏。
 */
export function cornerParams(kase: CaseDef, extraRandom: CaseParams[] = []): CaseParams[] {
  const dims = kase.drivers.map((d) => [
    d.levels[0]?.id,
    d.levels[d.levels.length - 1]?.id,
  ]);

  let acc: CaseParams[] = [{}];
  kase.drivers.forEach((d, i) => {
    const next: CaseParams[] = [];
    for (const base of acc) {
      for (const lv of dims[i]) next.push({ ...base, [d.id]: lv });
    }
    acc = next;
  });
  return [...acc, ...extraRandom];
}

/** 是否存在一组参数能让全部切片激活。用于断言「场景不是空壳」 */
export function anyAllActive(kase: CaseDef): CaseParams | null {
  const all = enumerateParams(kase);
  for (const p of all) {
    if (synthCase(kase, p).inactiveSlices.length === 0) return p;
  }
  return null;
}

/**
 * 「复制为 prompt」：把当前场景 + 参数 + 激活的切片决策拼成一段可直接喂给 AI 的需求描述。
 *
 * 刻意把「未命中的切片及其原因」也写进去：告诉 AI 哪些做法**不适用**，
 * 比只说要做什么更能防止它给出过度设计的方案。
 */
export function planToPrompt(plan: CasePlan): string {
  const { kase, params } = plan;
  const lines: string[] = [];
  lines.push(`# 场景：${kase.name}（${kase.subtitle}）`);
  lines.push('');
  lines.push(`问题：${kase.problem}`);
  lines.push('');
  lines.push('## 约束参数');
  for (const d of kase.drivers) {
    const cur = d.levels.find((l) => l.id === params[d.id]);
    lines.push(`- ${d.name}：${cur?.label ?? params[d.id]}${d.unit ? ' ' + d.unit : ''}`);
  }
  if (plan.warnings.length) {
    lines.push('');
    lines.push('## 已知矛盾');
    for (const w of plan.warnings) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push('## 已确认的设计决策');
  for (const d of plan.decisions) {
    lines.push(`- ${d.question} → ${d.chosen}（代价：${d.tradeoff}）`);
  }
  if (plan.inactiveSlices.length) {
    lines.push('');
    lines.push('## 以下做法在当前参数下不适用，不要给出');
    for (const s of plan.inactiveSlices) {
      lines.push(`- ${s.slice.goal}：${s.reason}`);
    }
  }
  lines.push('');
  lines.push('## 要求');
  lines.push('按上述约束给出建表 DDL 与 Java 代码。必须遵守：JDK 21 虚拟线程或自建线程池、');
  lines.push('禁 ForkJoinPool.commonPool、禁 Executors.newCachedThreadPool 裸用、批量提交、');
  lines.push('keyset 分页、限流与幂等。不要出现占位代码。');
  lines.push('');
  lines.push(`（本段由「杨先生的军火库 · 场景案例库」生成，涉及规则：${plan.rules.join('、')}）`);
  return lines.join('\n');
}

/** 切片代码的文件名，供下载 .java 使用 */
export function sliceFileName(kase: CaseDef, slice: CaseSlice): string {
  const cls = /public (?:final )?(?:class|interface|record) (\w+)/.exec(slice.code)?.[1];
  return `${cls ?? slice.id}.java`;
}
