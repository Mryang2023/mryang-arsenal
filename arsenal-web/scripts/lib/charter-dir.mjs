/**
 * 章程目录解析 —— **sync 与断言层共用这一份**。
 *
 * 为什么要单独抽一个函数（2026-10-05）：
 *   原本这段逻辑内联在 `sync-content.mjs` 里，断言层只能对着源码文本猜它怎么选 ——
 *   于是「三档优先级」实际上**零断言**：把 `??` 的顺序写反、把 env 拼错成 profile，
 *   整条链依然全绿。本仓已经为「同一规矩各内联一份」付过两次学费
 *   （sync 里的 cookbook 段、project-check【13】），这是第三次，不该再犯。
 *
 * 三档优先级（后者覆盖前者）：
 *   1. 默认 `<repo>/arsenal-charter`      —— 本仓自带一份
 *   2. `arsenal.json` 的 `project.charterDir` —— 事实源里声明，可提交可评审
 *   3. 环境变量 `ARSENAL_CHARTER_DIR`        —— CI / 业务仓场景
 *
 * 为什么要有第 2 档：待拍板项「章程放本仓还是业务仓」的答案是「两者都要支持」——
 * 事实源里声明一次，比每个开发机各配一个环境变量可靠。
 *
 * ★ **空串视作未设置**（这条是实现时补的，不是原设计）：
 *   CI 里 `ARSENAL_CHARTER_DIR:` 写空值极常见，而 `??` 只挡 `undefined` 不挡 `''`。
 *   空串会让 `path.resolve(repoRoot, '')` = repoRoot 本身，于是章程目录变成仓库根，
 *   `readdirSync` 捞不到任何 .json → 打印一行「暂无文件」→ **构建期一道闸都不跑，全绿**。
 *   「静默失效」是本仓最反感的形态，所以这里显式退档而不是让它悄悄生效。
 */

import fs from 'node:fs';
import path from 'node:path';

/** @typedef {1|2|3} CharterDirTier 1=内置默认 2=档案声明 3=环境变量（数字越大优先级越高） */

/**
 * @typedef {Object} CharterDirResolution
 * @property {string} dir    解析后的绝对路径
 * @property {string} raw    生效的原始值（未经 path.resolve，可能是相对路径）
 * @property {string} source 人读的来源标签（sync 会打印它）
 * @property {CharterDirTier} tier 实际命中的档位
 */

/** 空串与纯空白一律视作「没配」—— 见文件头 ★ 那段。 */
function usable(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * @param {Object} args
 * @param {string} args.repoRoot 仓库根（所有相对路径都按它解析，不是按 cwd）
 * @param {Record<string, string|undefined>} [args.env] 环境变量，默认 `process.env`
 * @param {string|null} [args.profileCharterDir] 档案里 `project.charterDir` 的值
 * @returns {CharterDirResolution}
 */
export function resolveCharterDir({ repoRoot, env, profileCharterDir = null }) {
  const e = env ?? process.env;
  const fromEnv = usable(e.ARSENAL_CHARTER_DIR);
  const fromProfile = usable(profileCharterDir);
  // ⚠️ 判据必须写 `!== null` 而不是「真值」：真值判断会**顺手**把空串也挡住，
  // 于是「空串退档」这条行为其实由 `if (fromEnv)` 兜着、而不是由 usable 兜着 ——
  // 一旦有人把 usable 简化成 `typeof v === 'string'`，三条空串断言里只有一条会红。
  // 守门人只能有一个，否则「谁在保护这条规则」没人说得清。
  if (fromEnv !== null) {
    return {
      dir: path.resolve(repoRoot, fromEnv),
      raw: fromEnv,
      source: '环境变量 ARSENAL_CHARTER_DIR',
      tier: 3,
    };
  }
  if (fromProfile !== null) {
    return {
      dir: path.resolve(repoRoot, fromProfile),
      raw: fromProfile,
      source: 'arsenal.json#project.charterDir',
      tier: 2,
    };
  }
  return {
    dir: path.resolve(repoRoot, 'arsenal-charter'),
    raw: 'arsenal-charter',
    source: '内置默认',
    tier: 1,
  };
}

/**
 * 读档案里的 `project.charterDir`（读不到就当没配 —— 调用方会把实际用的路径打印出来）。
 *
 * @param {string} profilePath `arsenal-profiles/arsenal.json` 的绝对路径
 * @returns {string|null}
 */
export function readProfileCharterDir(profilePath) {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))?.project?.charterDir ?? null;
  } catch {
    return null;
  }
}
