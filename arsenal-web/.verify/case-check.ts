/**
 * 场景案例库 —— 自检。
 *
 * 为什么需要这个：
 *
 * 本库唯一的核心承诺是「**参数变了，命中的切片必须变，而且没命中的必须说得出原因**」。
 * 它有三种失败方式，而且三种都不会报错：
 *   1. 静默省略 —— 切片没命中就直接不渲染，读者以为「这个参数下不需要做」，
 *      真相可能是「不能做」。所以守恒律 active + inactive === 总数 必须逐组合断言。
 *   2. 不确定的输出 —— 引擎里混进 Date / Math.random / 遍历顺序依赖，
 *      同参数两次结果不一样，「纯函数」就成了空话。所以要序列化比对。
 *   3. 空壳场景 —— 切片写了很多，但没有一组参数能让它们全激活，
 *      或者矛盾告警一条都触发不了。那样页面上的黄条和折叠区永远是摆设。
 *
 * 跑法：npm run verify:cases
 */
import fs from 'node:fs';
import path from 'node:path';
import { cases, casesMeta, defaultParams } from '@/lib/case-cases';
import {
  anyAllActive,
  cornerParams,
  enumerateParams,
  normalizeParams,
  planToPrompt,
  sliceFileName,
  synthCase,
} from '@/lib/case-synth';
import type { CaseDef, CaseParams } from '@/lib/case-types';
import { buildZip, crc32 } from '@/lib/zip-lite';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const webRoot = path.resolve(process.cwd());
const KNOWN_RULES = new Set<string>();
{
  const rulesDir = path.resolve(webRoot, '..', 'arsenal-rules');
  const walkJson = (o: unknown) => {
    if (Array.isArray(o)) return o.forEach(walkJson);
    if (o && typeof o === 'object') {
      const r = o as Record<string, unknown>;
      if (typeof r.id === 'string' && r.severity) KNOWN_RULES.add(r.id);
      Object.values(r).forEach(walkJson);
    }
  };
  const stack = [rulesDir];
  while (stack.length) {
    const dir = stack.pop()!;
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.json')) walkJson(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  }
}

const driversOf = (k: CaseDef) => new Map(k.drivers.map((d) => [d.id, d]));

console.log('\n【1】场景与驱动参数：id 唯一、档位离散可选');
{
  const ids = new Set<string>();
  let unique = true;
  let orderOk = true;
  cases.forEach((k, i) => {
    if (ids.has(k.id)) unique = false;
    ids.add(k.id);
    if (k.order !== i + 1) orderOk = false;
  });
  check('场景 id 唯一', unique);
  check('场景 order 连续（从 1 开始）', orderOk);
  check('meta.order 与实际场景一一对应',
    (casesMeta.order ?? []).join(',') === cases.map((k) => k.id).join(','),
    `meta=${(casesMeta.order ?? []).join(',')} 实际=${cases.map((k) => k.id).join(',')}`);

  let driverOk = true;
  let levelOk = true;
  let enoughDrivers = true;
  let enoughLevels = true;
  for (const k of cases) {
    const ds = new Set<string>();
    for (const d of k.drivers) {
      if (ds.has(d.id)) driverOk = false;
      ds.add(d.id);
      const ls = new Set<string>();
      for (const l of d.levels) {
        if (ls.has(l.id)) levelOk = false;
        ls.add(l.id);
      }
      if (d.levels.length < 2) enoughLevels = false;
    }
    if (k.drivers.length < 4) enoughDrivers = false;
  }
  check('每个场景内 driver.id 唯一', driverOk);
  check('每个驱动内 level.id 唯一', levelOk);
  check('每个场景至少 4 个驱动参数', enoughDrivers);
  check('每个驱动至少 2 个离散档位', enoughLevels);
}

console.log('\n【2】when 条件只引用已声明的 driver / level');
{
  const bad: string[] = [];
  const checkWhen = (k: CaseDef, when: Record<string, string[]> | undefined, where: string) => {
    const dm = driversOf(k);
    for (const [did, levels] of Object.entries(when ?? {})) {
      const d = dm.get(did);
      if (!d) {
        bad.push(`${where} → 未声明的 driver ${did}`);
        continue;
      }
      for (const lv of levels) {
        if (!d.levels.some((l) => l.id === lv)) {
          bad.push(`${where} → ${did} 未声明的档位 ${lv}`);
        }
      }
    }
  };
  for (const k of cases) {
    for (const s of k.slices) checkWhen(k, s.when, `${k.id}/${s.id}`);
    k.conflicts.forEach((c, i) => checkWhen(k, c.when, `${k.id}/conflict[${i}]`));
    k.notSuitableFor.forEach((n, i) => checkWhen(k, n.when, `${k.id}/notSuitableFor[${i}]`));
    for (const n of k.architecture?.nodes ?? []) checkWhen(k, n.whenAny, `${k.id}/arch/${n.id}`);
  }
  check('所有 when / whenAny 引用合法', bad.length === 0, bad.join('\n      '));
}

console.log('\n【3】锚点必须真的出现在代码里（mark 是片段不是行号）');
{
  const bad: string[] = [];
  let minTwo = true;
  for (const k of cases) {
    for (const s of k.slices) {
      if ((s.highlights ?? []).length < 2) {
        minTwo = false;
        bad.push(`${k.id}/${s.id} 只有 ${(s.highlights ?? []).length} 条 highlights`);
      }
      for (const h of s.highlights ?? []) {
        if (!(s.code ?? '').includes(h.mark)) {
          bad.push(`${k.id}/${s.id} 锚点找不到：${h.mark.slice(0, 50)}`);
        }
        if (h.rule && !KNOWN_RULES.has(h.rule)) {
          bad.push(`${k.id}/${s.id} 的 highlight 引用不存在的规则 ${h.rule}`);
        }
      }
    }
  }
  check('每个切片至少 2 条 highlights', minTwo);
  check('每个 mark 都命中代码、rule 引用真实存在', bad.length === 0, bad.join('\n      '));
}

console.log('\n【4】relatedRules 必须引用真实存在的规则 id');
{
  const bad: string[] = [];
  for (const k of cases) {
    for (const s of k.slices) {
      if (!(s.relatedRules ?? []).length) bad.push(`${k.id}/${s.id} 没有关联任何规则`);
      for (const r of s.relatedRules ?? []) {
        if (!KNOWN_RULES.has(r)) bad.push(`${k.id}/${s.id} → ${r}`);
      }
    }
  }
  check('规则 id 全部真实存在且非空', bad.length === 0, bad.join('\n      '));
}

console.log('\n【5】代码质量红线：不许占位、不许示范反模式');
{
  const bad: string[] = [];
  const stripComments = (code: string) =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');

  for (const k of cases) {
    for (const s of k.slices) {
      const body = stripComments(s.code ?? '');
      for (const anti of ['newCachedThreadPool', 'ForkJoinPool.commonPool', 'TODO', 'FIXME']) {
        if (body.includes(anti)) bad.push(`${k.id}/${s.id} 出现反模式/占位：${anti}`);
      }
      if (/\bbyte\[\]\s+\w+\s*=\s*\w+\.readAllBytes/.test(body)) {
        bad.push(`${k.id}/${s.id} 出现全量读字节（readAllBytes）`);
      }
      if (!/^(package|import|\/\*|\s*\/\*\*)/m.test(s.code.trim())) {
        bad.push(`${k.id}/${s.id} 代码缺 package/import 声明`);
      }
      if (!/class |interface |record /.test(s.code)) {
        bad.push(`${k.id}/${s.id} 代码没有类/接口/记录声明`);
      }
    }
  }
  check('无 TODO / 无反模式 / 无全量读字节 / 有类声明', bad.length === 0, bad.join('\n      '));
}

console.log('\n【6】守恒律：任意参数组合下 active + inactive === 切片总数（核心）');
{
  const bad: string[] = [];
  let combos = 0;
  for (const k of cases) {
    const all = enumerateParams(k, 20000);
    const paramsList = all.length ? all : cornerParams(k);
    combos += paramsList.length;
    for (const p of paramsList) {
      const plan = synthCase(k, p);
      if (plan.activeSlices.length + plan.inactiveSlices.length !== k.slices.length) {
        bad.push(`${k.id} 组合 ${JSON.stringify(p)} → ${plan.activeSlices.length}+${plan.inactiveSlices.length} ≠ ${k.slices.length}`);
        break;
      }
      for (const s of plan.inactiveSlices) {
        // 反着验一次：reason 必须是可核对的（含「该切片要求」与「当前」），不是一句「不适用」
        if (!s.reason.includes('该切片要求') || !s.reason.includes('当前')) {
          bad.push(`${k.id}/${s.slice.id} 的未命中原因不可核对：${s.reason}`);
        }
      }
    }
  }
  check(`全部 ${combos} 组参数下切片一个都不丢`, bad.length === 0, bad.join('\n      '));
}

console.log('\n【7】确定性：同参数两次调用结果逐字节一致（核心）');
{
  const bad: string[] = [];
  for (const k of cases) {
    const all = enumerateParams(k, 20000);
    const pool = all.length ? all : cornerParams(k);
    // 等距取 20 组（不随机 —— 断言本身也必须可复现）
    const step = Math.max(1, Math.floor(pool.length / 20));
    const sample: CaseParams[] = [];
    for (let i = 0; i < pool.length && sample.length < 20; i += step) sample.push(pool[i]);

    for (const p of sample) {
      const a = JSON.stringify(synthCase(k, p));
      const b = JSON.stringify(synthCase(k, p));
      if (a !== b) {
        bad.push(`${k.id} ${JSON.stringify(p)} 两次结果不一致`);
        break;
      }
    }
    // 归一化后重算也应一致（缺参数要补默认值）
    const partial: CaseParams = {};
    k.drivers.slice(0, 2).forEach((d) => {
      partial[d.id] = d.levels[0].id;
    });
    const na = JSON.stringify(synthCase(k, partial));
    const nb = JSON.stringify(synthCase(k, normalizeParams(k, partial)));
    if (na !== nb) bad.push(`${k.id} 参数归一化前后结果不一致`);
  }
  check('两次调用 / 归一化前后结果一致', bad.length === 0, bad.join('\n      '));
}

console.log('\n【8】不许有死切片；达不到「全激活」的场景必须把互斥 driver 声明出来');
{
  const bad: string[] = [];
  const ratios: string[] = [];
  for (const k of cases) {
    // 能全激活的场景天然不存在死切片，直接跳过（也省掉一次全量扫描）。
    if (anyAllActive(k)) {
      ratios.push(`${k.id} ${k.slices.length}/${k.slices.length}`);
      continue;
    }

    // 组合数超过 enumerateParams 的默认上限时它返回空数组 ——
    // 那种场景必须用角点采样兜底，否则会得出「一个切片都激活不了」的假结论。
    const all = enumerateParams(k);
    const pool = all.length ? all : cornerParams(k);

    const seen = new Set<string>();
    let maxActive = 0;
    for (const p of pool) {
      const plan = synthCase(k, p);
      maxActive = Math.max(maxActive, plan.activeSlices.length);
      for (const s of plan.activeSlices) seen.add(s.slice.id);
    }

    for (const s of k.slices) {
      if (!seen.has(s.id)) {
        bad.push(`${k.id}/${s.id} 没有任何参数组合能激活它 —— 永远不会出现在页面上的死切片`);
      }
    }

    if (maxActive < k.slices.length) {
      const groups = k.exclusiveGroups ?? [];
      if (groups.length === 0) {
        bad.push(
          `${k.id} 最多只能激活 ${maxActive}/${k.slices.length} 个切片，但没有声明 exclusiveGroups —— ` +
            '是设计上的互斥，还是条件写错了？必须说清楚，两者在外部看起来一模一样'
        );
      } else {
        // 声明的互斥必须**真的互斥**：存在两个切片在该 driver 上取值完全不相交。
        // 否则这个声明就是在给「条件写错了」打掩护 —— 那比不声明更糟。
        for (const g of groups) {
          if (!g.drivers?.length) bad.push(`${k.id} 的 exclusiveGroups 里存在空的 drivers`);
          if (!g.note || g.note.length < 20) {
            bad.push(`${k.id} 的 exclusiveGroups 缺少说明 —— 这段说明是给人看的，不是给校验看的`);
          }
          for (const d of g.drivers ?? []) {
            const sets = k.slices
              .map((s) => s.when?.[d])
              .filter((x): x is string[] => Array.isArray(x));
            if (sets.length < 2) {
              bad.push(`${k.id} 声明 ${d} 互斥，但引用它的切片少于 2 个 —— 互斥无从谈起`);
              continue;
            }
            let disjoint = false;
            for (let i = 0; i < sets.length && !disjoint; i += 1) {
              for (let j = i + 1; j < sets.length && !disjoint; j += 1) {
                if (!sets[i].some((lv) => sets[j].includes(lv))) disjoint = true;
              }
            }
            if (!disjoint) {
              bad.push(
                `${k.id} 声明 ${d} 互斥，但没有任何两个切片在 ${d} 上取值不相交 —— 这个声明是假的`
              );
            }
          }
        }
      }
    }
    ratios.push(`${k.id} ${maxActive}/${k.slices.length}`);
  }
  check('没有死切片；不能全激活的场景都已按事实声明互斥', bad.length === 0, bad.join('\n      '));
  console.log(`      各场景最大激活比：${ratios.join(' · ')}`);
}

console.log('\n【9】矛盾检测真的在工作：每个场景至少一组参数触发告警');
{
  const bad: string[] = [];
  for (const k of cases) {
    const all = enumerateParams(k, 20000);
    const pool = all.length ? all : cornerParams(k);
    const hit = pool.filter((p) => synthCase(k, p).warnings.length > 0);
    if (hit.length === 0) bad.push(`${k.id} 的 conflicts / notSuitableFor 一条都没触发`);
  }
  check('每个场景都至少有一组参数会标黄', bad.length === 0, bad.join('\n      '));
}

console.log('\n【10】合成引擎不硬编码架构节点，且 prompt / 文件名可用');
{
  const bad: string[] = [];
  for (const k of cases) {
    const nodeIds = new Set((k.architecture?.nodes ?? []).map((n) => n.id));
    for (const p of cornerParams(k)) {
      const a = synthCase(k, p).architecture;
      for (const n of a.nodes) {
        if (!nodeIds.has(n.id)) bad.push(`${k.id} 产出了数据里没有的节点 ${n.id}`);
      }
      const ids = new Set(a.nodes.map((n) => n.id));
      for (const l of a.links) {
        if (!ids.has(l.from) || !ids.has(l.to)) {
          bad.push(`${k.id} 连线悬空：${l.from} -> ${l.to}`);
        }
      }
    }
    const prompt = planToPrompt(synthCase(k, defaultParams(k)));
    if (prompt.length < 100) bad.push(`${k.id} 的 prompt 太短`);
    if (!prompt.includes(k.name)) bad.push(`${k.id} 的 prompt 没带场景名`);

    for (const s of k.slices) {
      const fn = sliceFileName(k, s);
      if (!fn.endsWith('.java')) bad.push(`${k.id}/${s.id} 文件名不是 .java：${fn}`);
    }
  }
  check('架构节点只来自数据、无悬空连线、prompt 与文件名可用',
    bad.length === 0, bad.join('\n      '));
}

console.log('\n【11】页面契约：/cases 路由、NAV 入口，以及【13】口径的导航双向一致性');
{
  const pageTsx = path.join(webRoot, 'src', 'app', 'cases', 'page.tsx');
  const labTsx = path.join(webRoot, 'src', 'app', 'cases', 'CaseLab.tsx');
  const shell = fs.readFileSync(path.join(webRoot, 'src', 'components', 'Shell.tsx'), 'utf8');

  check('/cases 路由存在（方案断言 10 第 1 条）', fs.existsSync(pageTsx));
  check('/cases 已挂进 NAV（方案断言 10 第 2 条）', /href: '\/cases'/.test(shell));

  // 下面两条与 project-check【13】① ② 同源 —— 这是方案断言 10 第 3 条所说的
  // 「【13】契约通过」。在这里再跑一遍是有意的：verify:cases 单独跑时也应该能抓到
  // 「NAV 有项但页面没建」这类错，而不是必须等整条链跑到 project-check 才知道。
  const appDir = path.join(webRoot, 'src', 'app');
  const navHrefs = [...shell.matchAll(/\{\s*href:\s*'([^']+)'/g)].map((m) => m[1]);
  const dangling = navHrefs.filter(
    (h) => h !== '/' && !fs.existsSync(path.join(appDir, h.replace(/^\//, ''), 'page.tsx'))
  );
  check('【13】① 口径：NAV 里每个地址都有页面', dangling.length === 0,
    `指向空地址：${dangling.join('、')}`);

  const orphans = fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.includes('['))
    .map((d) => `/${d.name}`)
    .filter((h) => !navHrefs.includes(h));
  check('【13】② 口径：没有孤儿页面（页面存在但导航里没有入口）', orphans.length === 0,
    `孤儿：${orphans.join('、')}`);

  check('CaseLab 是客户端组件',
    fs.existsSync(labTsx) && fs.readFileSync(labTsx, 'utf8').includes("'use client'"));
  check('page.tsx 渲染了 CaseLab',
    fs.existsSync(pageTsx) && fs.readFileSync(pageTsx, 'utf8').includes('<CaseLab'));
}

console.log('\n【12】事实源链路：JSON 由 tools/content/cases/*.py 生成');
{
  const gen = fs.readFileSync(
    path.resolve(webRoot, '..', 'tools', 'build-content.py'), 'utf8');
  const roots = fs.existsSync(path.resolve(webRoot, '..', 'arsenal-cases'));
  const modDir = fs.existsSync(path.resolve(webRoot, '..', 'tools', 'content', 'cases'));
  let allFiles = true;
  for (const k of cases) {
    if (!fs.existsSync(path.resolve(webRoot, '..', 'arsenal-cases', `${k.id}.json`))) {
      allFiles = false;
    }
  }
  check('build-content.py 里有 build_cases 且已挂进 main',
    gen.includes('def build_cases') && /def main\(\):[\s\S]*build_cases\(\)/.test(gen));
  check('tools/content/cases/ 存在，arsenal-cases/*.json 齐备',
    roots && modDir && allFiles);
  check('sync-content.mjs 有场景案例库闸门',
    fs.readFileSync(path.join(webRoot, 'scripts', 'sync-content.mjs'), 'utf8')
      .includes('arsenal-cases'));
}

console.log('\n【13】导出整包：ZIP 写出器必须产出结构自洽、能被标准工具解开的包');
{
  const encoder = new TextEncoder();

  // 与已知标准值比对：CRC-32("hello") = 0x3610a686。
  // 表生成写错（比如多项式写反）在这个值上会立刻暴露 ——
  // 而只做「长度不为 0」这类检查是抓不到的。
  const helloCrc = crc32(encoder.encode('hello'));
  check(
    'CRC-32 与标准值一致（"hello" → 0x3610a686）',
    helloCrc === 0x3610a686,
    `实际 0x${helloCrc.toString(16)}`
  );

  const entries = [
    { name: 'demo/01-a.java', data: 'class A {}' },
    { name: 'demo/schema.sql', data: 'CREATE TABLE t (id BIGINT);' },
  ];
  const zip = buildZip(entries);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u32 = (o: number) => view.getUint32(o, true);

  check('本地文件头签名正确（PK\\x03\\x04）', u32(0) === 0x04034b50);

  // EOCD 固定在末尾 22 字节（无注释）。三条量互为约束：
  // cdOffset + cdSize + 22 必须等于总长度，且中央目录签名就在 cdOffset 处。
  // 这一条能抓到「偏移算成相对中央目录」这个最常见的 zip 实现错误。
  const eocd = zip.byteLength - 22;
  check('EOCD 签名正确（PK\\x05\\x06，位于末尾 22 字节）', u32(eocd) === 0x06054b50);
  const entryCount = view.getUint16(eocd + 10, true);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);
  check(
    `条目数与偏移自洽（${entryCount} 条；${cdOffset}+${cdSize}+22=${cdOffset + cdSize + 22}＝${zip.byteLength}）`,
    entryCount === entries.length && cdOffset + cdSize + 22 === zip.byteLength
  );
  check('中央目录签名正确（PK\\x01\\x02）', u32(cdOffset) === 0x02014b50);
  check('文件名置了 UTF-8 标志位（flags bit 11）', view.getUint16(6, true) === 0x0800);

  // 导出物也要满足「同输入逐字节一致」—— 否则它不能算纯函数的产物
  // （而这一条恰好是「点两下导出得到两个不同文件」这类问题的唯一抓手）。
  const again = buildZip(entries);
  check(
    '同输入两次导出逐字节一致',
    zip.length === again.length && zip.every((b, i) => b === again[i])
  );
}

console.log(`\n${'─'.repeat(52)}`);
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exitCode = fail === 0 ? 0 : 1;
