#!/usr/bin/env node
/**
 * 杨先生的军火库 · MCP 一键安装（配置片段生成器）
 *
 * 纯 node 零依赖。做三件事：
 *   1. 从本文件位置推导仓库根（不写死盘符），从 arsenal-rules/mcp-tools.json 读
 *      launcher（command / args / env）—— 与前端导出器、后端导出器、MCP Server 共用同一份数据；
 *   2. 生成各 AI 客户端的 mcpServers 配置片段（__ARSENAL_HOME__ 占位符替换为本仓绝对路径）；
 *   3. 按需写入文件（--write），写出的文件一律 LF。
 *
 * 用法：
 *   node arsenal-server/scripts/mcp-install.mjs                 # 打印全部片段（默认）
 *   node arsenal-server/scripts/mcp-install.mjs --print         # 同上，显式
 *   node arsenal-server/scripts/mcp-install.mjs --write <路径> [--client claude|cursor|generic]
 *       # 把选中的片段（默认 generic）写入指定文件；目标已存在时拒绝覆盖（可 --force）
 *
 * 写入只负责「生成正确的片段」；把它合进客户端已有配置是人的事 ——
 * claude_desktop_config.json 里可能还住着别的 MCP 服务器，脚本替你合并就是越权。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ → arsenal-server/ → 仓库根。与 mcp-stdio.mjs 的自定位同一套写法。
const REPO_ROOT = resolve(__dirname, '..', '..');
const ARSENAL_HOME = REPO_ROOT.replace(/\\/g, '/'); // JSON 里用正斜杠，Windows 的 node 同样认

const RULES_DIR = join(REPO_ROOT, 'arsenal-rules');
const TOOLS_FILE = join(RULES_DIR, 'mcp-tools.json');

// ──────────────────────────────────────────────── 参数解析
const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}
const hasFlag = (flag) => argv.includes(flag);

const mode = hasFlag('--write') ? 'write' : 'print';
const client = (argValue('--client') ?? 'generic').toLowerCase();
const writeTarget = argValue('--write');
const force = hasFlag('--force');

const CLIENTS = {
  claude: {
    label: 'Claude Desktop',
    hint: '配置文件通常是 %APPDATA%\\Claude\\claude_desktop_config.json（Windows）或 ~/Library/Application Support/Claude/claude_desktop_config.json（macOS）',
  },
  cursor: {
    label: 'Cursor',
    hint: '配置文件通常是 ~/.cursor/mcp.json（全局）或项目根 .cursor/mcp.json（本项目）',
  },
  generic: {
    label: '通用 JSON',
    hint: '任何支持 MCP stdio 的客户端：形状都是 mcpServers，照客户端文档放到对应位置',
  },
};

if (!CLIENTS[client]) {
  process.stderr.write(`[arsenal-mcp-install] --client 只认 ${Object.keys(CLIENTS).join(' / ')}，收到：${client}\n`);
  process.exit(2);
}
if (mode === 'write' && (!writeTarget || writeTarget.startsWith('--'))) {
  process.stderr.write('[arsenal-mcp-install] --write 需要一个目标文件路径，例：--write ./arsenal-mcp.json\n');
  process.exit(2);
}

// ──────────────────────────────────────────────── 数据：launcher 来自唯一事实源
if (!existsSync(TOOLS_FILE)) {
  process.stderr.write(
    `[arsenal-mcp-install] 找不到 ${TOOLS_FILE}\n` +
      '  launcher 配置在 arsenal-rules/mcp-tools.json 里（唯一事实源）。请在本仓库内运行，或先检查仓库完整性。\n'
  );
  process.exit(1);
}
const toolsData = JSON.parse(readFileSync(TOOLS_FILE, 'utf8'));
const launcher = toolsData.launcher ?? {};
if (!launcher.command || !Array.isArray(launcher.args)) {
  process.stderr.write('[arsenal-mcp-install] mcp-tools.json 的 launcher 缺 command/args，数据有问题，先修数据。\n');
  process.exit(1);
}

const replaceHome = (s) => String(s).replaceAll('__ARSENAL_HOME__', ARSENAL_HOME);
const serverName = toolsData.server?.name ?? 'arsenal';

// mcpServers 形状：Claude Desktop / Cursor / 通用客户端都认这一种。
const mcpEntry = {
  command: replaceHome(launcher.command),
  args: (launcher.args ?? []).map(replaceHome),
  env: Object.fromEntries(
    Object.entries(launcher.env ?? {}).map(([k, v]) => [k, replaceHome(v)])
  ),
};
const snippet = JSON.stringify({ mcpServers: { [serverName]: mcpEntry } }, null, 2) + '\n';

// ──────────────────────────────────────────────── 输出
const ruleCount = existsSync(RULES_DIR)
  ? '规则目录就绪'
  : '警告：规则目录 arsenal-rules 不存在（ARSENAL_RULES_DIR 可在配置 env 里覆盖）';

if (mode === 'print') {
  console.log('杨先生的军火库 · MCP 配置片段生成器');
  console.log(`仓库根（从脚本位置推导，未写死盘符）：${ARSENAL_HOME}`);
  console.log('');
  for (const [key, c] of Object.entries(CLIENTS)) {
    console.log(`■ ${c.label}　—— ${c.hint}`);
    console.log(snippet.trimEnd());
    console.log('');
  }
  console.log(`数据自检：${ruleCount}；工具定义来自 arsenal-rules/mcp-tools.json（${(toolsData.tools ?? []).length} 个工具）。`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 把选中片段合入客户端配置（是合入 mcpServers，不是整文件覆盖）；');
  console.log('  2. 接入步骤、能力清单、常见问题：docs/MCP-接入指南.md；');
  console.log('  3. 装好后验证：node arsenal-server/scripts/mcp-probe.mjs（27 项断言，exit 0 即通）。');
} else {
  const target = resolve(writeTarget);
  if (existsSync(target) && statSync(target).isFile() && !force) {
    process.stderr.write(
      `[arsenal-mcp-install] 目标已存在：${target}\n` +
        '  已有配置里可能住着别的 MCP 服务器，脚本不替你合并。请手工合入片段，或 --force 覆盖（自担风险）。\n'
    );
    process.exit(1);
  }
  mkdirSync(dirname(target), { recursive: true });
  // writeFileSync + utf8 = 按内容原样写盘，不做换行翻译 → LF。
  writeFileSync(target, snippet, 'utf8');
  console.log(`已写入 ${CLIENTS[client].label} 片段 → ${target}`);
  console.log(`内容：${snippet.trimEnd()}`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 若该文件是客户端主配置，重启客户端让它加载；');
  console.log('  2. 接入步骤、能力清单、常见问题：docs/MCP-接入指南.md；');
  console.log('  3. 装好后验证：node arsenal-server/scripts/mcp-probe.mjs（27 项断言，exit 0 即通）。');
}
