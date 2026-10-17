'use client';

import { useRef, useState } from 'react';
import { PROFILE_SUMMARIES } from '@/lib/arch-views';
import type { ArchProfile, ProfileSummary } from '@/lib/arch-profile';
import { validateImport } from '../arch/profile-store';
import type { ProfileDraft } from '@/lib/profile-draft';
import { DRAFT_PROFILE_ID } from './SixViewsPanel';

/**
 * 档案条（架构图谱合并 · 棒2，拍板项 2 推荐位：架构面板顶部横条）。
 *
 * 为什么是横条而不是弹层：切档案与看图必须在同一视野里 ——
 * 「在输入区旁边」那个方案没扫描时管着六视图、扫描后又管不着，逻辑分叉。
 *
 * 三种档案：内置（▣，随仓库进版本）/ 本次扫描草稿（✦，扫描后才出现）/
 * 导入（⇪，只存在本机浏览器）。判据只有一份 —— `validateImport`
 * （形状 + token 两关），形状坏的档案在按下导入那一刻就被拒，不白屏。
 */

export default function ProfileBar({
  draft,
  profileId,
  custom,
  onPick,
}: {
  draft: ProfileDraft | null;
  profileId: string;
  custom: Record<string, ArchProfile>;
  onPick: (id: string, doc?: ArchProfile) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const customSummaries: ProfileSummary[] = Object.values(custom).map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.subtitle,
    note: p.note,
    builtin: false,
  }));

  /**
   * 导入一份档案 JSON。两道关都过才允许切：
   *   ① JSON 解析；② `validateImport`（形状 + token）。
   * 与 ProfilePicker 的 doImport 同判据（validateImport 是单一出处）——
   * 交互外壳两份是暂时的：棒3 /arch 退役后 ProfilePicker 整体消失，
   * 这里成为唯一入口。
   */
  const doImport = (raw: string): boolean => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setIssues([`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`]);
      return false;
    }
    const res = validateImport(parsed);
    if (!res.ok || !res.id) {
      setIssues(res.issues);
      return false;
    }
    if (PROFILE_SUMMARIES.some((b) => b.id === res.id)) {
      setIssues([`档案 id「${res.id}」与内置档案重名 —— 换个 id，否则「切到内置的那份」会指向不明`]);
      return false;
    }
    onPick(res.id, parsed as ArchProfile);
    setIssues([]);
    setDraftText('');
    setImportOpen(false);
    return true;
  };

  const chips: { id: string; name: string; subtitle?: string; mark: string; builtin: boolean }[] = [
    ...PROFILE_SUMMARIES.map((p) => ({ ...p, mark: '▣' })),
    ...(draft
      ? [{ id: DRAFT_PROFILE_ID, name: '本次扫描草稿', subtitle: draft.profile.subtitle, mark: '✦', builtin: false }]
      : []),
    ...customSummaries.map((p) => ({ ...p, mark: '⇪' })),
  ];

  return (
    <div className="rounded border border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mono mr-1 text-[10px] uppercase tracking-wider text-fgFaint">档案</span>
        {chips.map((p) => {
          const on = profileId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              title={p.subtitle ?? p.name}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-all duration-150 hover:border-lineHi"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.55)' : 'transparent',
                background: on ? 'rgba(217,164,65,0.12)' : 'transparent',
                color: on ? '#D9A441' : '#93A39C',
                fontWeight: on ? 650 : 400,
              }}
            >
              <span aria-hidden className="text-[10px] leading-none">
                {p.mark}
              </span>
              {p.name}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setImportOpen((v) => !v);
            setIssues([]);
          }}
          className="rounded-md border border-dashed px-2.5 py-1 text-[12px] transition-colors hover:bg-surfaceHi"
          style={{ borderColor: 'rgba(217,164,65,0.4)', color: '#D9A441' }}
        >
          {importOpen ? '收起' : '+ 导入 JSON'}
        </button>

        <span className="ml-auto text-[10px] text-fgFaint">换档案 = 换一套六视图，渲染代码零改动</span>
      </div>

      {/* 没扫描也要说清楚现在讲的是谁 —— 0 的情况本身就是一条结论 */}
      {!draft && (
        <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
          还没扫描 —— 六视图现在讲的是内置档案（构建期快照，离线可看）。在上面「一键分析」一个项目后，
          这里会出现「✦ 本次扫描草稿」。
        </p>
      )}

      {importOpen && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded border border-line px-2.5 py-1 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            >
              上传 .json
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const body = await f.text();
                setDraftText(body);
                doImport(body);
              }}
            />
            <button
              type="button"
              onClick={() => doImport(draftText)}
              disabled={!draftText.trim()}
              className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi disabled:opacity-40"
              style={{ borderColor: 'rgba(217,164,65,0.5)', color: '#D9A441' }}
            >
              导入粘贴的档案
            </button>
            <span className="text-[10px] text-fgFaint">
              照着 <span className="mono">arsenal-profiles/arsenal.json</span> 的结构写一份即可
            </span>
          </div>

          <textarea
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              setIssues([]);
            }}
            spellCheck={false}
            placeholder="粘贴一份项目档案 JSON（id / name / views / business / data / app / product / project）"
            className="mono mt-2 h-[120px] w-full resize-y rounded border border-line bg-transparent px-2.5 py-2 text-[11px] leading-[17px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
          />

          {issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {issues.map((it, i) => (
                <li key={`${i}-${it}`} className="flex gap-2 text-[11px] leading-[17px] text-fgMuted">
                  <span className="mono shrink-0" style={{ color: '#E5484D' }}>
                    ✗
                  </span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
            导入前会验两件事：① 六段视图齐不齐、字段有没有缺；② 档案里的 <span className="mono">{'{{token}}'}</span>{' '}
            能不能解析 —— 解不开的 token 会原样显示在图上，看着像页面坏了，所以在这里就拦掉。
            导入的档案只存在本机浏览器，不进仓库。
          </p>
        </div>
      )}
    </div>
  );
}
