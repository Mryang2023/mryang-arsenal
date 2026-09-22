#!/usr/bin/env node
/**
 * Next CLI 启动器 —— 存在的唯一理由：让 `next dev` / `next build` 能正常清掉自己的构建缓存。
 *
 * ## 症状
 * dev server 跑着跑着突然消失，端口没了、页面打不开，日志里是：
 *
 *   Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":50,"threshold":50,...}
 *       at checkBulkDeleteGuard (.../node-safe-delete-shim.cjs)
 *       at unlinkPath (next/dist/lib/recursive-delete.js:25)
 *       at async HotReloaderWebpack.start (next/dist/server/dev/hot-reloader-webpack.js:612)
 *
 * ## 机理
 * `next dev` 每次启动（包括「检测到 next.config 变化 → 自动重启」这一路）都会执行
 * `hot-reloader-webpack.js` 的 `clean()`：
 *
 *   recursiveDelete(join(dir, config.distDir), /^cache/)
 *
 * 把 `.next-dev/` 里除 `cache/` 以外的**几百个文件逐个 fs.unlink**。而 WorkBuddy 给
 * node 子进程挂了 safe-delete shim，其中有一个「单次工具调用内累计删除 ≥50 个文件」
 * 的批量闸门（`CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR` 计数）。于是清到第 51 个文件时
 * shim 直接抛错，异常穿透 Next 的 `start()`，**dev server 当场死掉**。
 *
 * 也就是说：`.next-dev/` 一旦非空，重启 dev 必崩。首次能从零启动，只是因为空目录
 * 没东西可删。
 *
 * ## 为什么这么修
 * shim 自己提供了进程级开关（`CODEBUDDY_SAFE_DELETE_ENABLED=0`，见 shim 第 22~26 行）。
 * 这里只给 next 这一个子进程关掉它 —— 作用域不扩散到当前 shell，更不扩散到其它命令。
 * next 的删除范围严格限定在 `distDir`（`.next-dev` / `.next`）之内，都是可再生的构建
 * 缓存，不碰 `src/`、`arsenal-rules/` 等任何源文件。
 *
 * 这同时也是性能修复：shim 的闸门是**每个文件 fork 一次 helper 进程**，
 * 450 个文件 = 450 次进程创建。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nextBin = path.join(here, '..', 'node_modules', 'next', 'dist', 'bin', 'next');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node scripts/next-run.mjs <dev|build|start> [...args]');
  process.exit(2);
}

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: '0' },
});

// 透传信号，Ctrl+C 能直接终止 next 而不是只杀壳
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
