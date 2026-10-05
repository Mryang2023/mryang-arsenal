/**
 * roster.ts —— **中枢团队名册**与章程手写名单的比对（工程规范 × 智慧中枢联动的 A 方向）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 要解决的那个具体缺陷
 *
 * 「某人已离队、他那笔豁免成了孤儿债」这条判据，依据是章程 JSON 里**手写的 team 名单**。
 * 手写名单必然过期，忘了更新孤儿债就永远发现不了 —— 而中枢里「人离开团队」是删
 * `team_members` 记录，是可查询的真值。`scripts/sync-roster.mjs` 把那份额真值搬过来，
 * 这里负责比对与**口径切换**。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 口径纪律（与 `gateReadiness` 拆 ciRunnable/astOnly 同一个教训）
 *
 * **中枢可用与不可用是两套口径，不许混着用。** 中枢可用时「在队」以中枢为准；
 * 不可用时回落到章程手写名单 —— 但**必须在任何输出里标明当前用的是哪一份**。
 * 混用的后果是：页面上「孤儿债 1 条」这个数字，有时候按中枢算、有时候按手写算，
 * 而看数字的人无从知道。
 */

import type { CharterDoc } from './charter';

export type RosterStatus = 'ok' | 'unavailable' | 'not-configured';

export interface RosterMember {
  name: string;
  role: string;
}

export interface RosterFile {
  schema?: string;
  status: RosterStatus;
  source?: string;
  teamId?: number | null;
  teamName?: string | null;
  fetchedAt?: string;
  members?: RosterMember[];
  error?: string | null;
}

export interface RosterDiff {
  /** 名册这次是否可用（status === 'ok' 且有成员） */
  available: boolean;
  status: RosterStatus;
  /** 当前「在队」判定用的是哪一份 —— 页面上必须原样说出来 */
  usedSource: 'command-center' | 'charter';
  teamName: string | null;
  fetchedAt: string;
  rosterNames: string[];
  charterNames: string[];
  /** 中枢有、章程没有 → 章程漏了新成员 */
  onlyInRoster: string[];
  /** 章程有、中枢没有 → **按中枢口径这个人已离队** */
  onlyInCharter: string[];
  agree: boolean;
  note: string;
}

/**
 * 比对名册与章程名单。
 *
 * @param file `src/generated/roster.json`（可能为 null：产物还没生成）
 * @param doc  章程
 */
export function rosterDiff(file: RosterFile | null | undefined, doc: CharterDoc): RosterDiff {
  const status: RosterStatus = file?.status ?? 'not-configured';
  const rosterNames = ((file?.members ?? []) as RosterMember[]).map((m) => m.name).filter(Boolean);
  const charterNames = (doc.team ?? []).filter(Boolean);
  const available = status === 'ok' && rosterNames.length > 0;

  if (!available) {
    const why = file?.error
      ? String(file.error)
      : status === 'ok'
        ? '名册里一个人都没有 —— 这不是「团队没人」，是数据不对，不采用'
        : '未接入中枢名册';
    return {
      available: false,
      status,
      usedSource: 'charter',
      teamName: file?.teamName ?? null,
      fetchedAt: file?.fetchedAt ?? '',
      rosterNames,
      charterNames,
      onlyInRoster: [],
      onlyInCharter: [],
      agree: false,
      note: `${why}。离队判定本次仍用章程手写的 team 名单（${charterNames.length} 人）—— 这份名单可能已过期。`,
    };
  }

  const rset = new Set(rosterNames);
  const cset = new Set(charterNames);
  const onlyInRoster = rosterNames.filter((n) => !cset.has(n));
  const onlyInCharter = charterNames.filter((n) => !rset.has(n));

  return {
    available: true,
    status,
    usedSource: 'command-center',
    teamName: file?.teamName ?? null,
    fetchedAt: file?.fetchedAt ?? '',
    rosterNames,
    charterNames,
    onlyInRoster,
    onlyInCharter,
    agree: onlyInRoster.length === 0 && onlyInCharter.length === 0,
    note: onlyInCharter.length
      ? `按中枢口径，下面这些人已不在团队：${onlyInCharter.join('、')}。若他们名下还有豁免，那些豁免已经转成孤儿债。`
      : onlyInRoster.length
        ? `中枢有、章程还没登记的人：${onlyInRoster.join('、')}。想让他们认领条款的话，把名字补进章程的 team。`
        : `两侧一致（${rosterNames.length} 人）。离队判定以中枢为准 —— 章程名单过期不会再伪装成「没人离队」。`,
  };
}

/**
 * 当前口径下的「在队」名单。
 * 中枢可用 → 中枢那份；不可用 → 章程手写那份。
 */
export function activeTeam(diff: RosterDiff): string[] {
  return diff.available ? diff.rosterNames : diff.charterNames;
}
