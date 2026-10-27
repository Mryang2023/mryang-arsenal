/**
 * 起后端 → 跑「需要后端」的那两层 → 一定把后端关干净。
 *
 * Why: `verify:parity` 的 3 项与 `verify:checkup` 的 9 项端到端断言在本机常年记成
 * 「未执行」—— 不是代码跑不了，是没人愿意手动起服务再手动关。
 * 这条脚本把「起—跑—关」绑成一个动作，并且**关不掉就报出来**：
 * 服务留在 3011 上会让下一次跑批读到上一个进程的状态（本仓在防的那类陈旧回执）。
 *
 * 用法：
 *   npm run verify:with-backend
 *   npm run verify:with-backend -- --keep     # 跑完不关后端（自己接着手动跑别的层）
 *
 * 退出码：0 = 两层全绿；1 = 任一层判负或后端起不来 / 关不干净；2 = 后端绿但层里有跳过。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const serverRoot = path.resolve(webRoot, '..', 'arsenal-server');
const PORT = Number(process.env.ARSENAL_PORT ?? 3011);
const START_TIMEOUT_MS = Number(process.env.BACKEND_START_TIMEOUT_MS ?? 90_000);
const LAYERS = ['verify:parity', 'verify:checkup'];
const keepBackend = process.argv.includes('--keep');

const say = (...a) => console.log(...a);

/** 端口上有没有人监听 —— 只问「连得上连不上」，不猜健康状态（健康由那两层自己判） */
const portOpen = () =>
  new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(1500, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });

/** 3011 的持有者 PID（Windows：netstat 的最后一列）。查不到返回 null */
const pidOnPort = () => {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
  for (const line of (r.stdout ?? '').split('\n')) {
    if (!/LISTENING/i.test(line)) continue;
    const m = /TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line.trim());
    if (m && Number(m[1]) === PORT) return m[2];
  }
  return null;
};

const stopPid = (pid) =>
  spawnSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force`], {
    encoding: 'utf8',
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 0. 已经在跑的后端**不抢也不杀**：那是别人的进程 ──────────────
const preexisting = await portOpen();
if (preexisting) {
  say(`· 3011 已有服务在跑（PID ${pidOnPort() ?? '?'}）—— 本次复用它，跑完不关`);
}

// ── 1. 起后端 ────────────────────────────────────────────────
let child = null;
let startupLog = '';
if (!preexisting) {
  if (!hasBuildOutput()) {
    say(`! 没找到编译产物（${path.join(serverRoot, 'target', 'classes')} 与 target/*.jar 都不在）`);
    say('  这一步不擅自替你编译：编译要 maven（本机 mvn 不在 PATH，见 BLOCKERS B-4/B-7）。');
    say('  先 `arsenal-server/mvnw -q -DskipTests package`，或复用已构建好的 target/。');
    process.exit(1);
  }
  say(`· 起后端：SKIP_COMPILE=1 bash scripts/run.sh（cwd=${serverRoot}）`);
  child = spawn('bash', ['scripts/run.sh'], {
    cwd: serverRoot,
    env: { ...process.env, SKIP_COMPILE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => (startupLog += b.toString()));
  child.stderr.on('data', (b) => (startupLog += b.toString()));

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) break;
    if (await portOpen()) break;
    await sleep(1000);
  }
  if (!(await portOpen())) {
    say(`✗ 后端 ${START_TIMEOUT_MS / 1000}s 内没起起来 —— 不假装「跳过也算过」，直接退出 1`);
    say(startupLog.split('\n').filter((l) => l.trim()).slice(-12).join('\n'));
    if (child && child.exitCode === null) child.kill('SIGTERM');
    process.exit(1);
  }
  say(`· 后端就绪（3011 · PID ${pidOnPort() ?? '?'}）`);
}

// ── 2. 跑那两层 ──────────────────────────────────────────────
const results = [];
try {
  for (const layer of LAYERS) {
    say(`\n▸ npm run ${layer}`);
    const r = spawnSync('npm', ['run', layer], { cwd: webRoot, encoding: 'utf8', shell: true });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(out);
    const statusLine = out
      .split('\n')
      .reverse()
      .find((l) => l.startsWith('ARSENAL-LAYER-STATUS'));
    let st = null;
    try {
      st = JSON.parse(statusLine.replace(/^ARSENAL-LAYER-STATUS\s*/, ''));
    } catch {
      /* 层没打机器可读行 —— 下面按退出码判 */
    }
    results.push({ layer, code: r.status ?? 1, st });
  }
} finally {
  // ── 3. 一定关后端（除非 --keep 或本来就有别人的在跑）──────────
  if (!preexisting && !keepBackend) {
    const pid = pidOnPort();
    if (pid === null) {
      say('\n· 后端已不在 3011 上（自己退了），无需清理');
    } else {
      say(`\n· 关后端：PID ${pid}（3011 的持有者 —— 起脚本的 bash 包装退场后 java 会留下来，必须按端口找）`);
      stopPid(pid);
      await sleep(1500);
      const still = pidOnPort();
      if (still) {
        say(`✗ 关停失败：3011 还被 PID ${still} 占着 —— 手工确认后再跑，别让下一次读到这个进程`);
        process.exitCode = 1;
      } else {
        say('· 3011 已归还');
      }
    }
    if (child && child.exitCode === null) child.kill('SIGTERM');
  } else if (!preexisting && keepBackend) {
    say(`\n! --keep：后端留在 3011（PID ${pidOnPort() ?? '?'}）—— 用完记得关，否则下一次跑批读到的是这个进程`);
  }
}

// ── 4. 汇总 ──────────────────────────────────────────────────
say('\n────────────────────────────────────────────────────────');
let worst = 0;
for (const r of results) {
  const s = r.st;
  const line = s
    ? `通过 ${s.pass} / 跳过 ${s.skip} / 失败 ${s.fail}（实测 ${s.measured} · 声明 ${s.declared}）`
    : `无机器可读状态行，按退出码 ${r.code} 判`;
  say(`${r.layer.padEnd(16)} ${line}`);
  if (r.code === 1 || (s && (s.fail > 0 || s.declaredMismatch))) worst = Math.max(worst, 1);
  else if (r.code === 2 || (s && s.skip > 0)) worst = Math.max(worst, 2);
}
if (worst === 2) say('（2 = 后端起来了但层里仍有「未执行」—— 看清点名的是哪几条，别当成通过）');
say(`退出码 ${worst}`);
process.exitCode = process.exitCode ?? worst;

/** target/ 里有没有可直接起的东西（classes 或 jar 任一） */
function hasBuildOutput() {
  const target = path.join(serverRoot, 'target');
  if (!fs.existsSync(target)) return false;
  if (fs.existsSync(path.join(target, 'classes'))) return true;
  return fs.readdirSync(target).some((f) => f.endsWith('.jar'));
}
