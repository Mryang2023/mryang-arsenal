import type { CategoryKey, Rule, Severity } from './types';
import { SEVERITY_ORDER, SEVERITY_THEME } from './theme';
import { meta, liveStats, categoryRank, categoryMetaOf, sourceTypeLabel } from './rules';
import mcpToolsRaw from '@/generated/mcp-tools.json';

/**
 * MCP 工具定义（来自 arsenal-rules/mcp-tools.json，只读）。
 *
 * 形状由 sync-rules.mjs 在构建期校验过（工具名不重复、description/inputSchema 齐全），
 * 所以这里不再做运行时兜底 —— 兜底会掩盖数据源的问题。
 */
const mcpTools = mcpToolsRaw as unknown as {
  server: { name: string; description: string; transport: string; protocolVersion: string };
  launcher: { command: string; args: string[]; env: Record<string, string> };
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
};

/**
 * 配置里的说明行。两端各写一份字面量是刻意的：
 * 它要进产物、又不能被序列化器改写风格，由 parity 逐字节比对守着 —— 一旦分叉就是红的。
 */
const MCP_CONFIG_COMMENT =
  'MCP Server 配置（stdio）。把 __ARSENAL_HOME__ 替换成本仓库的绝对路径后再用；' +
  '工具定义来自 arsenal-rules/mcp-tools.json，与后端导出器读的是同一份，两端产物逐字节一致。' +
  '适配层实现在 arsenal-server/scripts/mcp-stdio.mjs（只需 node；AST 深度判定已由后端 AstEngine 执行），' +
  '规则数据源为 arsenal-rules/**/*.json，此处不重复定义任何规则内容。';

export type ExportFormat = 'markdown' | 'prompt' | 'cursorrules' | 'claude' | 'mcp' | 'json';

export interface ExportOptions {
  severities: Severity[];
  categories: CategoryKey[];
  includeExamples: boolean;
  includeSources: boolean;
  includeRationale: boolean;
  includeChecks: boolean;
}

/** 规则集的分类顺序（数据声明顺序）。导出选项里的「全部分类」跟着数据走，不跟着写死的数组走。 */
const ALL_CATEGORIES = meta.categories.map((c) => c.key as CategoryKey);

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  severities: ['MUST', 'NEVER', 'SHOULD'],
  categories: [...ALL_CATEGORIES],
  includeExamples: true,
  includeSources: true,
  includeRationale: false,
  includeChecks: false,
};

export interface ExportFormatMeta {
  key: ExportFormat;
  name: string;
  target: string;
  filename: string;
  lang: string;
  blurb: string;
  why: string;
}

export const EXPORT_FORMATS: ExportFormatMeta[] = [
  {
    key: 'prompt', name: 'System Prompt', target: '任意 AI 对话框',
    filename: 'arsenal-system-prompt.md', lang: 'markdown',
    blurb: '一组祈使句约束，只有「该怎么做」，没有解释。',
    why: '最轻量。粘进 ChatGPT / Claude / DeepSeek 的自定义指令即可让这次对话遵守你的规范。',
  },
  {
    key: 'cursorrules', name: '.cursorrules', target: 'Cursor',
    filename: '.cursorrules', lang: 'markdown',
    blurb: 'Cursor 会自动读取项目根目录的这份文件。',
    why: '放进仓库根目录，Cursor 每次补全/生成都会带着这份约束，无需手动粘贴。',
  },
  {
    key: 'claude', name: 'CLAUDE.md', target: 'Claude Code',
    filename: 'CLAUDE.md', lang: 'markdown',
    blurb: 'Claude Code 的项目级记忆文件。',
    why: '等同于 .cursorrules，但服务于 Claude Code 的工作流（含文件结构与命令约定）。',
  },
  {
    key: 'markdown', name: '规范书', target: '人读 / 归档',
    filename: 'arsenal-spec.md', lang: 'markdown',
    blurb: '完整文档：理由 + 反例 + 正例 + 出处溯源。',
    why: '给人看的版本。新人接手、方案评审、或你自己很久之后回头查「当初为什么这么定」。',
  },
  {
    key: 'mcp', name: 'MCP Server', target: '支持 MCP 的 AI 客户端',
    filename: 'arsenal-mcp.json', lang: 'json',
    blurb: '让 AI 主动来查规范，而不是被动接收。',
    why: 'P1 阶段的核心。AI 写代码时自己调用 arsenal.search_rules 查约束 —— 这是唯一能真正治本的出口。',
  },
  {
    key: 'json', name: '原始规则集', target: '二次开发 / 自建管道',
    filename: 'arsenal-rules.json', lang: 'json',
    blurb: '未经加工的 Rule 对象数组。',
    why: '给校验引擎、CI 插件或你自己的脚本用。schema 见 arsenal-rules/_schema/rule.schema.json。',
  },
];

function pick(rules: Rule[], o: ExportOptions): Rule[] {
  return rules
    .filter((r) => r.status === 'active')
    .filter((r) => o.severities.includes(r.severity))
    .filter((r) => o.categories.includes(r.category))
    .sort(
      (a, b) =>
        (categoryRank.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
          (categoryRank.get(b.category) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
    );
}

function langOf(r: Rule): string {
  const g = r.check?.regex?.targetGlob ?? '';
  if (g.includes('.sql')) return 'sql';
  if (g.includes('xml')) return 'xml';
  if (g.includes('yml') || g.includes('yaml') || g.includes('properties')) return 'yaml';
  if (g.includes('commit-msg')) return 'text';
  return 'java';
}

function fence(code: string, lang: string): string {
  const body = (code ?? '').trimEnd();
  // 防止内容里出现 ``` 把围栏截断
  const safe = body.replace(/```/g, '``\u200b`');
  return '```' + lang + '\n' + safe + '\n```';
}

function severityLegend(): string {
  return SEVERITY_ORDER.map(
    (s) => `- **${SEVERITY_THEME[s].label}（${s}）**：${SEVERITY_THEME[s].meaning}`
  ).join('\n');
}

function header(rules: Rule[], title: string, note: string): string {
  const sev = { MUST: 0, NEVER: 0, SHOULD: 0, MAY: 0 } as Record<Severity, number>;
  for (const r of rules) sev[r.severity] += 1;
  return [
    `# ${title}`,
    '',
    `> ${note}`,
    `> `,
    `> 版本 **${meta.version}** ｜ 条目 **${rules.length}** 条 ｜ ` +
      `强制级 ${sev.MUST + sev.NEVER} 条（强制 ${sev.MUST} / 禁止 ${sev.NEVER}）｜ 建议级 ${sev.SHOULD} 条`,
    `> 适用技术栈：${meta.targetStack.language} · ${meta.targetStack.framework} · ${meta.targetStack.database}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 各载体实现

function buildPrompt(rules: Rule[], o: ExportOptions): string {
  const L: string[] = [];
  L.push('# 代码规范约束');
  L.push('');
  L.push(
    '以下约束**优先级高于你的默认编码风格**。生成代码前先读一遍；' +
      '若某条约束与你的习惯冲突，以约束为准，不要自行变通。'
  );
  L.push('');
  L.push(`适用技术栈：${meta.targetStack.language} / ${meta.targetStack.framework} / ${meta.targetStack.database}（jakarta 命名空间，Maven 构建）。`);
  L.push('');

  const groups: { key: Severity; heading: string; lead: string }[] = [
    { key: 'MUST', heading: '一、强制项（MUST）', lead: '违反即为错误，不要提交这样的代码。' },
    { key: 'NEVER', heading: '二、禁止项（NEVER）', lead: '出现即需返工，没有例外。' },
    { key: 'SHOULD', heading: '三、建议项（SHOULD）', lead: '默认遵守；确有理由时可以偏离，但请在注释里写明理由。' },
    { key: 'MAY', heading: '四、风格项（MAY）', lead: '仅作参考，保持项目内一致即可。' },
  ];

  for (const g of groups) {
    const list = rules.filter((r) => r.severity === g.key);
    if (!list.length) continue;
    L.push(`## ${g.heading}`);
    L.push('');
    L.push(`_${g.lead}_`);
    L.push('');
    list.forEach((r, i) => {
      L.push(`${i + 1}. ${r.promptFragment}  <sub>${r.id}</sub>`);
    });
    L.push('');
  }

  if (o.includeExamples) {
    L.push('---');
    L.push('');
    L.push('## 附：逐条细则与示例');
    L.push('');
    L.push('_仅在你需要判断边界时查阅，不必通读。_');
    L.push('');
    for (const r of rules) {
      L.push(`### ${r.id} ${r.title}`);
      L.push('');
      L.push(`- **级别**：${SEVERITY_THEME[r.severity].label}`);
      if (o.includeRationale) {
        L.push(`- **为什么**：${r.rationale}`);
      }
      L.push('');
      L.push('**❌ 反例**');
      L.push('');
      L.push(fence(r.bad, langOf(r)));
      L.push('');
      L.push('**✅ 正例**');
      L.push('');
      L.push(fence(r.good, langOf(r)));
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push(
    `_本约束由「杨先生的军火库」导出（v${meta.version}，${rules.length} 条）。` +
      '规则数据源为结构化 JSON，人查 / 给 AI 用 / 拿代码验三处共用同一份数据。_'
  );
  return L.join('\n');
}

function buildMarkdown(rules: Rule[], o: ExportOptions): string {
  const L: string[] = [];
  L.push(header(rules, `${meta.name} · 规范书`, '这份文档由规则数据自动生成，请勿手工修改——改数据源。'));
  L.push('## 级别说明');
  L.push('');
  L.push(severityLegend());
  L.push('');

  // 按「传给本函数的这份列表」分组，全流程复用同一个 Map ——
  // 目录和各分类正文章节必须看到同一份数据，否则又会出现「标题 9 条、下面列 3 条」。
  // 后端 ExporterService.byCategoryOf 用的是同一种分组（按首次出现顺序），
  // 两端因此必然得出一致的分类顺序与条目数。
  const grouped = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = grouped.get(r.category) ?? [];
    list.push(r);
    grouped.set(r.category, list);
  }

  // 目录
  L.push('## 目录');
  L.push('');
  for (const [cat, list] of grouped) {
    L.push(`- **${categoryMetaOf(cat).name}**（${list.length}）`);
    for (const r of list) L.push(`  - \`${r.id}\` ${r.title}`);
  }
  L.push('');
  L.push('---');
  L.push('');

  for (const [cat, list] of grouped) {
    const t = categoryMetaOf(cat);
    L.push(`## ${t.name} · ${t.english}`);
    L.push('');
    L.push(`> ${t.blurb}`);
    L.push('');

    for (const r of list) {
      L.push(`### \`${r.id}\` ${r.title}`);
      L.push('');
      const tags = (r.tags ?? []).map((x) => `\`${x}\``).join(' ');
      L.push(`**级别** ${SEVERITY_THEME[r.severity].label}（${r.severity}）` + (tags ? `　**标签** ${tags}` : ''));
      L.push('');

      if (o.includeRationale) {
        L.push('**为什么要有这条**');
        L.push('');
        L.push(r.rationale);
        L.push('');
      }

      if (o.includeExamples) {
        L.push('**❌ 反例**');
        L.push('');
        L.push(fence(r.bad, langOf(r)));
        L.push('');
        L.push('**✅ 正例**');
        L.push('');
        L.push(fence(r.good, langOf(r)));
        L.push('');
      }

      L.push('**约束句（可直接给 AI）**');
      L.push('');
      L.push('> ' + r.promptFragment);
      L.push('');

      if (o.includeChecks) {
        const c = r.check ?? {};
        L.push('**检查方式**');
        L.push('');
        if (c.regex) {
          L.push(`- 正则（${c.regex.expect === 'present' ? '必须命中' : '命中即违规'}，作用于 \`${c.regex.targetGlob ?? '**/*'}\`）：`);
          L.push('');
          L.push('  ```');
          L.push('  ' + c.regex.pattern);
          L.push('  ```');
        }
        if (c.ast) L.push(`- AST：\`${c.ast.query}\`（引擎 ${c.ast.engine ?? 'javaparser'}）`);
        if (c.llm) L.push(`- 语义判定：${c.llm}`);
        if (c.manual) L.push(`- 人工检查：${c.manual}`);
        L.push('');
      }

      if (o.includeSources) {
        L.push('**来源**');
        L.push('');
        for (const s of r.sources) {
          L.push(`- ${s.ref}　<sub>${sourceTypeLabel(s.type)}</sub>`);
          if (s.quote) L.push(`  > ${s.quote}`);
        }
        L.push('');
      }

      L.push('---');
      L.push('');
    }
  }

  L.push('');
  L.push(
    `_生成自 arsenal-rules（v${meta.version}）。共 ${rules.length} 条，` +
      `其中强制级 ${liveStats.mustClass} 条（当前上限 ${liveStats.mustHardLimit}，已用 ${liveStats.budgetUsedPct}%）。_`
  );
  // 结尾换行同 buildJson：后端 ExporterService.buildMarkdown 按同一份形状生成，
  // 逐字节一致性由 `npm run verify:parity` 断言。
  return L.join('\n') + '\n';
}

function buildCursorRules(rules: Rule[], o: ExportOptions): string {
  const L: string[] = [];
  L.push('# 项目代码规范（.cursorrules）');
  L.push('');
  L.push(
    '本文件由「杨先生的军火库」自动生成。生成或修改代码时，以下约束优先级最高。' +
      '如果我的要求与之冲突，先提醒我，不要默默违反。'
  );
  L.push('');
  L.push(
    `技术栈：${meta.targetStack.language} / ${meta.targetStack.framework} / ` +
      `${meta.targetStack.database}。使用 jakarta.* 命名空间（不要用 javax.*），Maven 构建。`
  );
  L.push('');

  const blocks: { key: Severity; title: string }[] = [
    { key: 'MUST', title: '必须做到' },
    { key: 'NEVER', title: '绝对不要做' },
    { key: 'SHOULD', title: '建议做法' },
  ];

  for (const b of blocks) {
    const list = rules.filter((r) => r.severity === b.key);
    if (!list.length) continue;
    L.push(`## ${b.title}`);
    L.push('');
    for (const r of list) L.push(`- ${r.promptFragment}`);
    L.push('');
  }

  if (o.includeExamples) {
    L.push('## 关键写法对照');
    L.push('');
    const withExamples = rules.filter((r) => r.severity === 'MUST' || r.severity === 'NEVER').slice(0, 25);
    for (const r of withExamples) {
      L.push(`### ${r.title}`);
      L.push('');
      L.push('不要这样写：');
      L.push('');
      L.push(fence(r.bad, langOf(r)));
      L.push('');
      L.push('应该这样写：');
      L.push('');
      L.push(fence(r.good, langOf(r)));
      L.push('');
    }
  }

  L.push('---');
  L.push(`<!-- 来源：杨先生的军火库 v${meta.version}，共 ${rules.length} 条规则 -->`);
  return L.join('\n');
}

function buildClaude(rules: Rule[], o: ExportOptions): string {
  const L: string[] = [];
  L.push('# CLAUDE.md');
  L.push('');
  L.push('## 项目代码规范');
  L.push('');
  L.push(
    '本项目所有代码必须遵守「杨先生的军火库」规范集。以下条目是硬约束，' +
      '生成代码前请先对照检查，提交前请自查一遍。'
  );
  L.push('');
  L.push(`- **规范版本**：v${meta.version}（${meta.releasedAt}）`);
  L.push(`- **技术栈**：${meta.targetStack.language} / ${meta.targetStack.framework} / ${meta.targetStack.database}`);
  L.push(`- **命名空间**：jakarta（不是 javax）`);
  L.push(`- **构建**：${meta.targetStack.build}`);
  L.push('');

  L.push('### 强制项（MUST）——违反即返工');
  L.push('');
  rules.filter((r) => r.severity === 'MUST').forEach((r) => L.push(`- [ ] ${r.promptFragment}`));
  L.push('');

  L.push('### 禁止项（NEVER）——出现即返工');
  L.push('');
  rules.filter((r) => r.severity === 'NEVER').forEach((r) => L.push(`- [ ] ${r.promptFragment}`));
  L.push('');

  if (rules.some((r) => r.severity === 'SHOULD')) {
    L.push('### 建议项（SHOULD）');
    L.push('');
    rules.filter((r) => r.severity === 'SHOULD').forEach((r) => L.push(`- [ ] ${r.promptFragment}`));
    L.push('');
  }

  if (o.includeExamples) {
    L.push('### 常见错误写法对照');
    L.push('');
    const key = rules.filter((r) => r.severity === 'MUST' || r.severity === 'NEVER').slice(0, 20);
    for (const r of key) {
      L.push(`**${r.title}**`);
      L.push('');
      L.push(fence(r.bad, langOf(r)));
      L.push('');
      L.push('改为：');
      L.push('');
      L.push(fence(r.good, langOf(r)));
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push(`> 完整规则（含理由与出处）：见 \`arsenal-rules/\`　｜　在线查阅：${meta.name} v${meta.version}`);
  return L.join('\n');
}

/** 缩进：整体右移 n 空格。用于把嵌套 JSON 挂到某个键后面（首行不缩进，它跟在键名后面）。 */
function indentBlock(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

/** 紧凑但留一处空格的单行对象：{ "K": "V" }。两端同一套写法。 */
function inlineObject(o: Record<string, string>): string {
  const parts = Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
}

/**
 * MCP Server 配置。
 *
 * 工具定义来自 arsenal-rules/mcp-tools.json（由 sync-rules 编译成 @/generated/mcp-tools.json），
 * 后端 ExporterService.buildMcp 读的是同一份文件 —— 两端产物逐字节一致，
 * 由 npm run verify:parity 断言。
 *
 * 早先这里硬编码了一份 90 行 schema、后端只给一个 _tools 字符串数组，
 * 「两端不一致」被写进注释当成了刻意的妥协。工具定义变成数据之后，这个妥协就没有理由了。
 *
 * 逐字节一致是怎么做到的：不比较序列化后的对象（两边的 pretty-printer 风格本来就不同，
 * Jackson 吐 `"a" : 1`、JSON.stringify 吐 `"a": 1`，比出来永远红），
 * 而是像 buildMarkdown 一样**按行手工拼**，嵌套 schema 用同一套缩进规则渲染。
 * 形状摆成一样之后，改动就变成「两边照着同一处改」。
 *
 * 另外修掉一处旧隐患：产物结尾曾挂一个块注释说明，而文件名是 arsenal-mcp.json ——
 * 交出去的根本不是合法 JSON。说明文字现在一律进 $comment。
 */
function buildMcp(rules: Rule[]): string {
  const { server, launcher, tools } = mcpTools;

  const L: string[] = [];
  L.push('{');
  L.push(`  "$comment": "${MCP_CONFIG_COMMENT}",`);
  L.push('  "mcpServers": {');
  L.push(`    "${server.name}": {`);
  L.push(`      "command": ${JSON.stringify(launcher.command)},`);
  L.push(`      "args": ${JSON.stringify(launcher.args)},`);
  L.push(`      "env": ${inlineObject(launcher.env)},`);
  L.push('      "disabled": false');
  L.push('    }');
  L.push('  },');
  L.push('');
  L.push('  "_availableRules": ' + rules.length + ',');
  L.push('  "$toolDefinitions": ' + indentBlock(JSON.stringify(tools, null, 2), 2));
  L.push('}');
  L.push('');
  return L.join('\n');
}

/**
 * 原始规则集。
 *
 * 结尾的换行是刻意的：文本文件以换行结束是通用约定。
 *
 * 与后端 ExporterService.buildJson 的一致性口径是**逐结构**而不是逐字节：
 * 对象键无序、数组有序、未设置的字段不出现。JSON 的空白不是内容，
 * 强行比字节只会因为两边的 pretty-printer 风格不同而永远红。
 * 一致性由 `npm run verify:parity` 断言，exportedAt 是唯一被容忍的易变字段。
 */
function buildJson(rules: Rule[]): string {
  return (
    JSON.stringify(
      {
        ruleset: meta.ruleset,
        name: meta.name,
        version: meta.version,
        exportedAt: new Date().toISOString(),
        count: rules.length,
        rules: rules.map(({ _weight, _hasStaticCheck, _checkLayer, _sourceFile, ...r }) => r),
      },
      null,
      2
    ) + '\n'
  );
}

export function buildExport(format: ExportFormat, allRules: Rule[], o: ExportOptions): string {
  const list = pick(allRules, o);
  switch (format) {
    case 'prompt': return buildPrompt(list, o);
    case 'markdown': return buildMarkdown(list, o);
    case 'cursorrules': return buildCursorRules(list, o);
    case 'claude': return buildClaude(list, o);
    case 'mcp': return buildMcp(list);
    case 'json': return buildJson(list);
    default: return '';
  }
}

export function formatBytes(s: string): string {
  const bytes = new TextEncoder().encode(s).length;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function estimateTokens(s: string): number {
  // 中文约 1.6 字符/token，代码与英文约 3.5 字符/token，取保守混合值
  return Math.round(s.length / 2.4);
}
