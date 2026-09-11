import type { CategoryKey, Rule, Severity } from './types';
import { CATEGORY_ORDER, CATEGORY_THEME, SEVERITY_ORDER, SEVERITY_THEME, SOURCE_TYPE_LABEL } from './theme';
import { meta, liveStats } from './rules';

export type ExportFormat = 'markdown' | 'prompt' | 'cursorrules' | 'claude' | 'mcp' | 'json';

export interface ExportOptions {
  severities: Severity[];
  categories: CategoryKey[];
  includeExamples: boolean;
  includeSources: boolean;
  includeRationale: boolean;
  includeChecks: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  severities: ['MUST', 'NEVER', 'SHOULD'],
  categories: [...CATEGORY_ORDER],
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
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
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

  // 目录
  L.push('## 目录');
  L.push('');
  for (const cat of CATEGORY_ORDER) {
    const list = rules.filter((r) => r.category === cat);
    if (!list.length) continue;
    const t = CATEGORY_THEME[cat];
    L.push(`- **${t.name}**（${list.length}）`);
    for (const r of list) L.push(`  - \`${r.id}\` ${r.title}`);
  }
  L.push('');
  L.push('---');
  L.push('');

  for (const cat of CATEGORY_ORDER) {
    const list = rules.filter((r) => r.category === cat);
    if (!list.length) continue;
    const t = CATEGORY_THEME[cat];
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
          const label = SOURCE_TYPE_LABEL[s.type ?? ''] ?? s.type ?? '来源';
          L.push(`- ${s.ref}　<sub>${label}</sub>`);
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
  return L.join('\n');
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

function buildMcp(rules: Rule[]): string {
  const toolSchema = {
    name: 'arsenal',
    description:
      '杨先生的军火库 · 代码规范查询服务。写代码前用它查约束，写完用它验合规。',
    transport: {
      stdio: {
        command: 'java',
        args: ['-jar', 'arsenal-server-0.1.0.jar'],
        env: { ARSENAL_RULES_DIR: './arsenal-rules' },
      },
    },
    tools: [
      {
        name: 'search_rules',
        description: '按关键词检索规范条目。写代码前调用，拿到本次任务相关的约束句。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '关键词，如「controller 入参」「线程池」「事务」' },
            severity: { type: 'string', enum: ['MUST', 'NEVER', 'SHOULD', 'MAY'], description: '可选，限定级别' },
            category: { type: 'string', description: '可选，限定分类' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_rule',
        description: '按 ID 取单条规则的完整定义（含反例、正例、检查方式）。',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: '规则 ID，如 WEB-CTRL-002' } },
          required: ['id'],
        },
      },
      {
        name: 'lint_code',
        description: '提交代码前自检。返回违规清单（带行号）与合规分。',
        inputSchema: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '文件路径，用于匹配 targetGlob' },
            content: { type: 'string', description: '文件内容' },
          },
          required: ['filename', 'content'],
        },
      },
      {
        name: 'get_prompt',
        description: '取一份完整的约束提示词，用于把规范注入当前会话。',
        inputSchema: {
          type: 'object',
          properties: {
            severity: { type: 'string', description: '可选，如 "MUST,NEVER"' },
          },
        },
      },
    ],
  };

  const L: string[] = [];
  L.push('{');
  L.push('  "$comment": "MCP Server 配置预览（P1 阶段实现）。规则数据源为 arsenal-rules/**/*.json，无需重复定义。",');
  L.push('  "mcpServers": {');
  L.push('    "arsenal": {');
  L.push('      "command": "java",');
  L.push('      "args": ["-jar", "arsenal-server-0.1.0.jar"],');
  L.push('      "env": { "ARSENAL_RULES_DIR": "./arsenal-rules" },');
  L.push('      "disabled": false');
  L.push('    }');
  L.push('  },');
  L.push('');
  L.push('  "$toolDefinitions": ' + JSON.stringify(toolSchema, null, 2).split('\n').join('\n  '));
  L.push('}');

  L.push('');
  L.push('/*');
  L.push(` * 当前规则集：${rules.length} 条，可直接被 search_rules 检索。`);
  L.push(' * 设计意图：让 AI 在写代码的当下主动来查约束，而不是靠人事先粘贴提示词。');
  L.push(' * 这是「一份数据三种出口」中唯一能形成闭环的一环 —— 其余两处都是被动消费。');
  L.push(' */');
  return L.join('\n');
}

function buildJson(rules: Rule[]): string {
  return JSON.stringify(
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
