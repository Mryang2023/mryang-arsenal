'use client';

import { archProfileShapeIssues, buildMetrics, unknownTokens, type ArchProfile } from '@/lib/arch-profile';

/**
 * 导入档案的本地存放。
 *
 * 内置档案随仓库进版本（`arsenal-profiles/*.json` → 构建期快照），
 * 导入的档案**不存在仓库里** —— 它只活在这台机器的浏览器里。
 * 这是刻意的：别的项目的架构资料不该因为我们想看一眼就被提交进军火库。
 * 要让它成为长期档案，就把它落成 `arsenal-profiles/<id>.json` 再同步一次。
 */

const KEY = 'arsenal-arch-profiles-v1';

export interface CustomProfileSet {
  [id: string]: ArchProfile;
}

export function loadCustomProfiles(): CustomProfileSet {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // 存进去的时候校验过，但用户可能手改过 localStorage —— 读的时候再挡一次，
    // 一份形状坏掉的档案会让整个 /arch 白屏，那比「这份档案不见了」严重得多
    const out: CustomProfileSet = {};
    for (const [id, doc] of Object.entries(parsed as Record<string, unknown>)) {
      if (archProfileShapeIssues(doc).length === 0) out[id] = doc as ArchProfile;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCustomProfiles(set: CustomProfileSet): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(set));
  } catch {
    // 配额满 / 隐私模式：导入当场会提示，这里没必要再吵一次
  }
}

export interface ImportResult {
  ok: boolean;
  /** 成功时是档案 id */
  id?: string;
  issues: string[];
}

/**
 * 校验一份要导入的 JSON。**形状与 token 两关都过**才算能用 ——
 * 只过形状的话，页面上会冒出一串 `{{rules.total}}` 字面量，
 * 看着像我们的 bug，其实是那份档案写了我们解不开的 token。
 */
export function validateImport(raw: unknown): ImportResult {
  const shape = archProfileShapeIssues(raw);
  if (shape.length) return { ok: false, issues: shape };

  const p = raw as ArchProfile;
  const verifyTotal = (p.project?.verifyChain ?? []).reduce((n, v) => n + (v.count ?? 0), 0);
  const unknown = unknownTokens(p, buildMetrics(verifyTotal));
  if (unknown.length) {
    return {
      ok: false,
      issues: [
        `解不开的 token：${unknown.map((t) => `{{${t}}}`).join('、')}`,
        '档案里只许出现 arch-profile.ts 的 buildMetrics() 登记过的 token —— 能算的数字必须算，不许手抄。',
      ],
    };
  }
  return { ok: true, id: p.id, issues: [] };
}
