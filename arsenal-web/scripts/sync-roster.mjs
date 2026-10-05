#!/usr/bin/env node
/**
 * sync-roster.mjs —— 拉中枢团队名册，写 `src/generated/roster.json`。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 它解决什么（不是「要整合」，是一个具体缺陷）
 *
 * 工程规范判断「某人已离队、他那笔豁免成了孤儿债」，依据是章程里**手写的 team 名单**。
 * 手写名单必然过期，忘了更新就永远发现不了孤儿债 —— 而中枢里「人离开团队」是
 * 删 `team_members` 记录，是**可查询的真值**。这个脚本把那份额真值搬过来。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 三条纪律
 *
 * 1. **拉不到不阻断构建。** 未配置 / 连不上 / 401 / 超时 → 写 `status: 'unavailable'`
 *    并打印原因，退出码仍是 0。理由：把「中枢不可用」变成「发不了版」，等于让两个
 *    系统互相绑架。处置口径是**页面提示差异**（拍板结果），不是构建失败。
 *    —— 但**「未配置」和「拉失败」要分得清**：前者是忘了配，后者是中枢挂了。
 * 2. **名册不是判负依据，只是判据的加强。** 中枢不可用时回落到章程手写名单，
 *    页面标明当前用的是哪一份。理由同「两套判定口径不许混」。
 * 3. **最小暴露。** 中枢侧只给 userId/name/role/joinedAt，这里也只留 name/role。
 *    邮箱与头像不进 Git（名册会进版本库，那是组织信息）。
 *
 * 用法（挂 `npm run sync` 链；也可单跑）：
 *   ARSENAL_CC_BASE_URL=http://127.0.0.1:3001 \
 *   ARSENAL_CC_API_KEY=<与中枢 integrations.roster.api-key 一致> \
 *   ARSENAL_CC_TEAM_ID=1 \
 *   node scripts/sync-roster.mjs
 * 三件都没配 → 写 not-configured，退出码 0（这是绝大多数仓库的常态）。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const outPath = path.join(webRoot, 'src', 'generated', 'roster.json');

const BASE = (process.env.ARSENAL_CC_BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.ARSENAL_CC_API_KEY || '';

/**
 * 拉哪支团队：**env > 章程的 teamRef > 未配置**。
 *
 * 为什么要有章程这一档：`team` 名单是手写的、必然过期，而名册要拉「哪支队」是
 * 章程自己的属性，不该只存在于某个开发机的环境变量里。env 仍能覆盖 —— 那是
 * 「同一份章程在多支团队上各拉一次」的场景（一份规范、多个仓库）。
 */
function teamIdFromCharter() {
  const dir = process.env.ARSENAL_CHARTER_DIR
    ? path.resolve(process.env.ARSENAL_CHARTER_DIR)
    : path.resolve(here, '..', '..', 'arsenal-charter');
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const t = doc && doc.teamRef;
      if (t && t.system === 'command-center' && Number.isFinite(Number(t.teamId)) && Number(t.teamId) > 0) {
        return { id: String(t.teamId), name: t.teamName || null, from: `${f}#teamRef` };
      }
    }
  } catch {
    // 章程目录读不到不算失败：下面统一按「未配置」处理并打印原因
  }
  return null;
}

const FROM_CHARTER = process.env.ARSENAL_CC_TEAM_ID ? null : teamIdFromCharter();
const TEAM = process.env.ARSENAL_CC_TEAM_ID || (FROM_CHARTER ? FROM_CHARTER.id : '');

/** 统一写盘：任何路径都要留下一个可读的产物（哪怕是「没拉到」）——不留文件等于让页面猜。 */
function write(status, extra = {}) {
  const payload = {
    schema: 'arsenal-roster/1',
    status,
    source: 'command-center',
    baseUrl: BASE || null,
    teamId: TEAM ? Number(TEAM) : null,
    fetchedAt: new Date().toISOString(),
    members: [],
    ...extra,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

if (!BASE || !KEY || !TEAM) {
  const missing = [
    !BASE && 'ARSENAL_CC_BASE_URL',
    !KEY && 'ARSENAL_CC_API_KEY',
    !TEAM && 'ARSENAL_CC_TEAM_ID',
  ].filter(Boolean);
  const p = write('not-configured', {
    error: `未配置 ${missing.join(' / ')} —— 离队判定本次仍用章程手写的 team 名单`,
  });
  console.log(`[roster] 未配置（${missing.join(' / ')}）→ 写 not-configured，页面会显示「本次未校验名册」`);
  if (!process.env.ARSENAL_CC_TEAM_ID && !FROM_CHARTER) {
    console.log('         提示：在章程里加 "teamRef": { "system": "command-center", "teamId": N }，'
      + '就不用每次配环境变量了（env 仍可覆盖）');
  }
  console.log(`         ${p.error}`);
  process.exit(0);
}

const endpoint = `${BASE}/api/integrations/teams/${encodeURIComponent(TEAM)}/roster`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8000);

try {
  const res = await fetch(endpoint, {
    headers: { 'X-API-Key': KEY, Accept: 'application/json' },
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (res.status === 503) {
    const p = write('unavailable', { error: '中枢未配置 integrations.roster.api-key（503）—— 名册不可读' });
    console.log(`[roster] 中枢报「集成口未配置」→ ${p.error}`);
    process.exit(0);
  }
  if (res.status === 401) {
    const p = write('unavailable', { error: 'X-API-Key 无效（401）—— 核对两侧是否同一份 key' });
    console.log(`[roster] ${p.error}`);
    process.exit(0);
  }
  if (!res.ok) {
    const p = write('unavailable', { error: `中枢返回 ${res.status} ${res.statusText}` });
    console.log(`[roster] ${p.error}`);
    process.exit(0);
  }

  const body = await res.json();
  const data = body && body.data ? body.data : null;
  if (!data || !Array.isArray(data.members)) {
    const p = write('unavailable', { error: '中枢响应里没有 data.members（契约变了？）—— 本次不采用' });
    console.log(`[roster] ${p.error}`);
    process.exit(0);
  }

  const members = data.members
    .map((m) => ({ name: String(m.name ?? '').trim(), role: String(m.role ?? 'member') }))
    .filter((m) => m.name !== '');
  const p = write('ok', {
    teamName: data.teamName ?? null,
    members,
    memberCount: members.length,
    error: null,
  });
  const via = process.env.ARSENAL_CC_TEAM_ID ? '环境变量' : `章程 ${FROM_CHARTER.from}`;
  console.log(`[roster] 名册已同步 · 团队「${p.teamName ?? TEAM}」· ${members.length} 人 · 来自 ${p.fetchedAt}`);
  console.log(`         团队 id ${TEAM} 取自${via}${FROM_CHARTER?.name ? `（章程记的名字：${FROM_CHARTER.name}）` : ''}`);
  console.log(`         角色分布：${JSON.stringify(members.reduce((a, m) => ({ ...a, [m.role]: (a[m.role] || 0) + 1 }), {}))}`);
  process.exit(0);
} catch (e) {
  clearTimeout(timer);
  const why = e && e.name === 'AbortError' ? '超时 8s' : String(e && e.message ? e.message : e);
  const p = write('unavailable', { error: `拉不到中枢名册：${why} —— 离队判定本次仍用章程手写名单` });
  console.log(`[roster] ${p.error}`);
  process.exit(0);
}
