'use client';

import { useCallback, useRef, useState } from 'react';
import type { ArchProfile, ProfileSummary } from '@/lib/arch-profile';
import { adoptPicks, type PicksProvenance } from '@/lib/picks-store';
import type { StackPicks } from '@/lib/content-types';
import { useRouter } from 'next/navigation';
import { loadCustomProfiles, saveCustomProfiles, validateImport } from './profile-store';
import CodeIntake from '@/components/CodeIntake';
import { scanFacts, scanUpload, type ScanOutcome } from '@/lib/arsenal-api';
import { buildProfileDraftFromFacts } from '@/lib/profile-draft';

/**
 * 项目档案选择器 —— 这是「六视图泛化」在界面上的那一半。
 *
 * 六张图讲的从来是**某个项目**，不是军火库这个功能本身。所以第一等操作
 * 是「换一个项目」，两条路并列（与 /autopsy 解剖台同款入口）：
 *   ① **填一个项目地址**（本地目录 / https git / 上传 zip）—— 扫一遍代码
 *      仓库，把扫描读得到的部分填进档案草稿，读不到的留 TODO；
 *   ② **换一份已有档案** —— 内置档案随仓库走（`arsenal-profiles/<id>.json`，
 *      构建期快照），导入档案只存在本机浏览器里。
 *
 * 约束：走哪条路都要**先过校验**才允许切换。一份形状不对的档案会让六张图
 * 全白，用户看到的是「架构图谱坏了」，而不是「我导入的文件不对」——
 * 报错必须发生在按下「选这个项目 / 导入」的那一刻。
 */

type PathMode = 'path' | 'git' | 'zip';

type ScanState =
  | { kind: 'idle' }
  | { kind: 'scanning'; what: string }
  | { kind: 'done'; name: string; todos: number; filled: number }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

const MODES: [PathMode, string, string][] = [
  ['path', '本地目录', 'D:/mryang/workspace/2026/arsenal/arsenal-server'],
  ['git', 'https git', 'https://github.com/owner/repo.git'],
  ['zip', '上传 zip', ''],
];

export default function ProfilePicker({
  builtin,
  activeId,
  onPick,
}: {
  builtin: ProfileSummary[];
  activeId: string;
  onPick: (id: string, doc?: ArchProfile) => void;
}) {
  const [custom, setCustom] = useState<Record<string, ArchProfile>>(() => loadCustomProfiles());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ── 路径/git/zip 选项目（与 /autopsy 解剖台同款入口）──
  const [mode, setMode] = useState<PathMode>('path');
  const [source, setSource] = useState('');
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });
  const zipRef = useRef<HTMLInputElement>(null);

  /**
   * 把扫描出来的选型交给装配台。
   *
   * 本页的主线是「换一个项目档案」，但扫描顺带算出来的 picks 也该有个去处 ——
   * 以前它只在这块面板里显示一遍就散了。**先写盘再跳页**：
   * 装配台挂载时读的就是这份快照，顺序反了会载入上一套选型且不报错。
   */
  const adoptToStack = useCallback(
    (picks: StackPicks, provenance: PicksProvenance) => {
      adoptPicks(picks, provenance);
      router.push('/stack');
    },
    [router]
  );

  const customSummaries: ProfileSummary[] = Object.values(custom).map((p) => ({
    id: p.id,
    name: p.name,
    subtitle: p.subtitle,
    note: p.note,
    builtin: false,
  }));

  const doImport = useCallback(
    (raw: string) => {
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
      const doc = parsed as ArchProfile;
      if (builtin.some((b) => b.id === res.id)) {
        setIssues([`档案 id「${res.id}」与内置档案重名 —— 换个 id，否则「切到内置的那份」会指向不明`]);
        return false;
      }
      const next = { ...custom, [res.id]: doc };
      setCustom(next);
      saveCustomProfiles(next);
      setIssues([]);
      setDraft('');
      setOpen(false);
      setNotice(`已导入「${doc.name}」，六张图已切过去。它只存在本机浏览器里，重新导入才在别的设备可见。`);
      onPick(res.id, doc);
      return true;
    },
    [builtin, custom, onPick]
  );

  /**
   * 一键「选这个项目」：扫描 → 生成档案草稿 → 直接导入。
   *
   * 与 /autopsy 解剖台走同一对函数（`scanFacts` / `scanUpload`）—— 不自己拼
   * 请求，也不假装离线兜底：本地目录 / git / zip 都要后端在线。档案草稿里的
   * TODO 是**刻意的**（业务定位、消费方这些代码里读不到），导入后页面上会
   * 亮出「N 条来自扫描 / M 条留了 TODO」，把成熟度说清楚，不当成品卖。
   */
  const onPickFromPath = useCallback(async () => {
    let outcome: ScanOutcome;
    if (mode === 'zip') {
      const file = zipRef.current?.files?.[0];
      if (!file) return;
      setScan({ kind: 'scanning', what: `上传 ${file.name}` });
      outcome = await scanUpload(file);
    } else {
      const value = source.trim();
      if (!value) return;
      setScan({ kind: 'scanning', what: `扫描 ${value}` });
      outcome = await scanFacts({ kind: mode, value });
    }

    if (outcome.kind === 'facts') {
      const draft = buildProfileDraftFromFacts(outcome.facts);
      if (draft.issues.length > 0) {
        setScan({
          kind: 'failed',
          code: 'BAD_DRAFT',
          message: `档案草稿形状校验未过：${draft.issues.join('；')}`,
          offline: false,
        });
        return;
      }
      const ok = doImport(JSON.stringify(draft.profile));
      if (!ok) {
        setScan({
          kind: 'failed',
          code: 'IMPORT_FAILED',
          message: issues.length ? issues.join('；') : '导入被拒（形状或 id 冲突）',
          offline: false,
        });
        return;
      }
      setScan({
        kind: 'done',
        name: draft.profile.name,
        todos: draft.todos.length,
        filled: draft.filled,
      });
      setNotice(
        `已扫「${draft.profile.name}」并导入 —— ${draft.filled} 条来自扫描，` +
          `${draft.todos.length} 条留了 TODO 由你补（代码里读不到的部分），` +
          `只存在本机浏览器。`
      );
      return;
    }
    if (outcome.kind === 'offline') {
      setScan({ kind: 'failed', code: 'OFFLINE', message: outcome.message, offline: true });
      return;
    }
    setScan({ kind: 'failed', code: outcome.code, message: outcome.message, offline: false });
  }, [mode, source, doImport, issues]);

  const remove = useCallback(
    (id: string) => {
      const next = { ...custom };
      delete next[id];
      setCustom(next);
      saveCustomProfiles(next);
      if (activeId === id) onPick(builtin[0]?.id ?? '');
    },
    [activeId, builtin, custom, onPick]
  );

  const chips = [...builtin, ...customSummaries];

  return (
    <div className="panel px-3 py-2.5">
      {/* ── 一、填一个项目地址（与 /autopsy 解剖台同款入口）── */}
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        一、选一个项目（路径 / git / zip）
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded border border-line p-0.5">
          {MODES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id);
                setScan({ kind: 'idle' });
              }}
              className={
                'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                (mode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'zip' ? (
          <input
            ref={zipRef}
            type="file"
            accept=".zip,application/zip"
            className="text-[11px] text-fgMuted file:mr-2 file:rounded file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-[11px] file:text-fgMuted"
            onChange={() => setScan({ kind: 'idle' })}
          />
        ) : (
          <input
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setScan({ kind: 'idle' });
            }}
            spellCheck={false}
            placeholder={MODES.find((m) => m[0] === mode)?.[2] ?? ''}
            className="mono min-w-[260px] flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-hidden placeholder:text-fgFaint focus:border-lineHi"
          />
        )}

        <button
          type="button"
          onClick={() => void onPickFromPath()}
          disabled={
            scan.kind === 'scanning' ||
            (mode !== 'zip' && !source.trim()) ||
            (mode === 'zip' && !zipRef.current?.files?.[0])
          }
          className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          style={{
            borderColor: 'rgba(217,164,65,0.5)',
            background: 'rgba(217,164,65,0.12)',
            color: '#D9A441',
          }}
        >
          {scan.kind === 'scanning' ? '扫描中…' : '选这个项目'}
        </button>

        <span className="ml-auto text-[10px] text-fgFaint">
          扫一遍仓库 → 生成档案草稿 → 六张图切过去
        </span>
      </div>

      {scan.kind === 'scanning' && (
        <p className="mt-1.5 mono text-[11px] text-fgMuted">{scan.what} …</p>
      )}

      {scan.kind === 'done' && (
        <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#7FA650' }}>
          已导入「{scan.name}」—— {scan.filled} 条来自扫描，{scan.todos} 条留了 TODO 由你补；
          六张图已切过去，档案只存本机浏览器。
        </p>
      )}

      {scan.kind === 'failed' && (
        <div
          className="mt-1.5 rounded border px-2.5 py-1.5"
          style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
            {scan.offline ? '后端连不上（:3011 没起）' : `扫描被拒：${scan.code}`}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-[16px] text-fgMuted">{scan.message}</p>
          {scan.offline && (
            <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">
              起后端：<span className="mono">SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh</span>
              。三条入口（本地目录 / git / zip）都要后端在线。
            </p>
          )}
        </div>
      )}

      {/* ── 二、已选档案 ── */}
      <div className="mt-2.5 border-t border-line pt-2">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">二、已选档案</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chips.map((p) => {
            const on = activeId === p.id;
            return (
              <span key={p.id} className="group relative inline-flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    onPick(p.id, custom[p.id]);
                    setNotice(null);
                    setScan({ kind: 'idle' });
                  }}
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
                    {p.builtin ? '▣' : '⇪'}
                  </span>
                  {p.name}
                  {!p.builtin && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`移除 ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          remove(p.id);
                        }
                      }}
                      className="mono ml-0.5 rounded px-1 text-[10px] text-fgFaint hover:bg-surfaceHi hover:text-fg"
                    >
                      ×
                    </span>
                  )}
                </button>
              </span>
            );
          })}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-dashed px-2.5 py-1 text-[12px] transition-colors hover:bg-surfaceHi"
            style={{ borderColor: 'rgba(217,164,65,0.4)', color: '#D9A441' }}
          >
            {open ? '收起' : '+ 导入 JSON'}
          </button>

          <span className="ml-auto text-[10px] text-fgFaint">
            换项目 = 换一份档案，渲染代码零改动
          </span>
        </div>
      </div>

      {notice && (
        <p className="mt-2 border-t border-line pt-2 text-[10.5px] leading-[16px] text-fgMuted">{notice}</p>
      )}

      {open && (
        <div className="mt-2.5 border-t border-line pt-2.5">
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
                setDraft(body);
                doImport(body);
              }}
            />
            <button
              type="button"
              onClick={() => doImport(draft)}
              disabled={!draft.trim()}
              className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi disabled:opacity-40"
              style={{ borderColor: 'rgba(217,164,65,0.5)', color: '#D9A441' }}
            >
              导入粘贴的档案
            </button>
            <span className="text-[10px] text-fgFaint">
              照着 <code className="mono">arsenal-profiles/arsenal.json</code> 的结构写一份即可
            </span>
          </div>

          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setIssues([]);
            }}
            spellCheck={false}
            placeholder='粘贴一份项目档案 JSON（id / name / views / business / data / app / product / project）'
            className="mono mt-2 h-[160px] w-full resize-y rounded border border-line bg-transparent px-2.5 py-2 text-[11px] leading-[17px] text-fg outline-hidden placeholder:text-fgFaint focus:border-lineHi"
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
            导入前会验两件事：① 六段视图齐不齐、字段有没有缺；② 档案里的
            <code className="mono mx-1">{'{{token}}'}</code>
            能不能解析 —— 解不开的 token 会原样显示在图上，看着像页面坏了，所以在这里就拦掉。
          </p>

          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-[10px] leading-[15px] text-fgFaint">
              懒得从空文件写？扫一遍代码仓库，把扫描读得到的部分先填进档案骨架，
              读不到的（业务定位、消费方、非目标）留 TODO 由你补。走的是同一套校验。
            </p>
            <CodeIntake
              variant="profile"
              onProfile={(profile) => {
                const ok = doImport(JSON.stringify(profile));
                if (!ok) return;
                setNotice(`已导入「${profile.name}」，六张图已切过去。`);
              }}
              onPicks={adoptToStack}
            />
          </div>
        </div>
      )}
    </div>
  );
}
