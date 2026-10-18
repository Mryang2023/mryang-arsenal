'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  addProject,
  deleteProject,
  getProject,
  listProjects,
  refreshProject,
  type ProjectDetail,
  type ProjectEntry,
  type ProjectKind,
  type ProjectSource,
} from '@/lib/projects-api';
import { setActiveProject, useActiveProject } from '@/lib/active-project';

/**
 * 项目管理页（工坊棒2）。一屏四区：
 *   ① 当前项目横幅（名字 / 来源 / 缓存时间 / 新鲜度 / 切换）
 *   ② 添加项目表单（名字 + 类型 + 地址 → 摄取）
 *   ③ 项目列表（表格 → 移动端降级卡片行）
 *   ④ 底部说明（限额 / 缓存位置 / 删除语义）
 *
 * 后端不在时**不是错误**：静态站允许后端离线，页面必须给四种不同显示
 * （连不上 / 拿到了 / 被拒 / 加载中），不许把「没跑」说成「健康」。
 */
export default function ProjectManager() {
  const router = useRouter();
  const active = useActiveProject();

  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'offline'>('loading');
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // ── 加载列表 ──
  const reload = useCallback(() => {
    setLoadState('loading');
    setError(null);
    listProjects().then((out) => {
      if (out.kind === 'ok') {
        setProjects(out.data);
        setLoadState('ok');
      } else if (out.kind === 'offline') {
        setLoadState('offline');
        setError(out.message);
      } else {
        setLoadState('ok');
        setError(`读取项目列表失败：${out.message}`);
      }
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload, reloadKey]);

  // ── 添加项目 ──
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('path');
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const submitAdd = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedName || !trimmedValue) {
      setAddMsg({ tone: 'err', text: '名字与地址都要填。' });
      return;
    }
    setAdding(true);
    setAddMsg(null);
    const source: ProjectSource = { kind, value: trimmedValue };
    addProject({ name: trimmedName, source }).then((out) => {
      setAdding(false);
      if (out.kind === 'ok') {
        const entry = out.data;
        // 添加成功即设为当前项目（这是项目工坊的主心智：先选一个固定项目）
        setActiveProject({ id: entry.id, name: entry.name });
        setProjects((prev) => [entry, ...prev]);
        setName('');
        setValue('');
        setAddMsg({ tone: 'ok', text: `已添加「${entry.name}」并设为当前项目，代码正在缓存中。` });
      } else if (out.kind === 'rejected') {
        setAddMsg({ tone: 'err', text: `${out.code}：${out.message}` });
      } else {
        setAddMsg({ tone: 'err', text: out.message });
      }
    });
  }, [name, value, kind]);

  // ── 删除（确认框写清 QA 历史保留）──
  const [pendingDelete, setPendingDelete] = useState<ProjectEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    setDeleting(true);
    deleteProject(pendingDelete.id).then((out) => {
      setDeleting(false);
      setPendingDelete(null);
      if (out.kind === 'ok') {
        setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id));
        // 删的是当前项目 → 清当前选择（守卫空态会接管）
        if (active?.id === pendingDelete.id) setActiveProject(null);
      } else if (out.kind === 'rejected') {
        setError(`删除失败：${out.code} ${out.message}`);
      } else {
        setError(out.message);
      }
    });
  }, [pendingDelete, active]);

  // ── 行内入口：设为当前并跳转（P0 ④）──
  const openWith = useCallback(
    (entry: ProjectEntry, target: '/autopsy' | '/qa') => {
      setActiveProject({ id: entry.id, name: entry.name });
      router.push(target);
    },
    [router]
  );

  const setCurrent = useCallback((entry: ProjectEntry) => {
    setActiveProject({ id: entry.id, name: entry.name });
  }, []);

  // ── 当前项目横幅：拉详情补新鲜度（后端可达时）──
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  useEffect(() => {
    if (!active?.id || loadState === 'offline') {
      setDetail(null);
      return;
    }
    let alive = true;
    getProject(active.id).then((out) => {
      if (alive && out.kind === 'ok') setDetail(out.data);
      else if (alive) setDetail(null);
    });
    return () => {
      alive = false;
    };
  }, [active?.id, loadState, reloadKey]);

  const onRefresh = useCallback(() => {
    if (!active?.id) return;
    setLoadState('loading');
    refreshProject(active.id).then((out) => {
      if (out.kind === 'ok') {
        setDetail(out.data);
        setProjects((prev) => prev.map((p) => (p.id === active.id ? { ...p, cache: out.data.cache } : p)));
      }
      setLoadState('ok');
    });
  }, [active?.id]);

  const activeEntry = useMemo(
    () => projects.find((p) => p.id === active?.id) ?? null,
    [projects, active?.id]
  );

  return (
    <div className="mx-auto max-w-[920px]">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-fg">项目管理</h1>
        <p className="mt-1 text-sm text-fgMuted">
          项目工坊的第一个子项。先在这里选一个固定项目，再进「项目侦察」与「质检台」——
          两个功能页只认当前项目，不再用临时地址。
        </p>
      </header>

      {/* ① 当前项目横幅 */}
      <CurrentBanner
        active={active}
        entry={activeEntry}
        detail={detail}
        offline={loadState === 'offline'}
        onRefresh={onRefresh}
        onSwitch={() => document.getElementById('project-list')?.scrollIntoView({ behavior: 'smooth' })}
      />

      {/* ② 添加项目表单 */}
      <section className="mt-6 rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fgMuted">添加项目</h2>
        {loadState === 'offline' ? (
          <p className="text-sm text-fgMuted">
            后端 :3011 不可达，暂时不能摄取代码。本地偏好（当前项目）仍可设置；起服务后即可添加。
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-fgMuted">项目名</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="order-service"
                  className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brass"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-fgMuted">类型</span>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ProjectKind)}
                  className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brass"
                >
                  <option value="path">本地目录</option>
                  <option value="git">https git</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-fgMuted">
                  {kind === 'path' ? '目录路径' : 'git 地址（https）'}
                </span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kind === 'path' ? 'D:/work/order-service' : 'https://github.com/owner/repo'}
                  className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm text-fg outline-none focus:border-brass"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={adding}
              onClick={submitAdd}
              className="rounded bg-brass px-4 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {adding ? '摄取中…' : '摄取并添加'}
            </button>
          </div>
        )}
        {addMsg && (
          <p
            className="mt-3 text-sm"
            style={{ color: addMsg.tone === 'ok' ? '#7FA650' : '#E5484D' }}
          >
            {addMsg.text}
          </p>
        )}
      </section>

      {/* ③ 项目列表 */}
      <section id="project-list" className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fgMuted">
          项目列表
          {loadState === 'ok' ? `（${projects.length} 个）` : ''}
        </h2>

        {loadState === 'loading' && <p className="text-sm text-fgMuted">读取中…</p>}
        {loadState === 'offline' && (
          <p className="rounded border border-line bg-surface p-4 text-sm text-fgMuted">{error}</p>
        )}
        {loadState === 'ok' && error && (
          <p className="mb-3 rounded border border-line bg-surface p-3 text-sm" style={{ color: '#E5484D' }}>
            {error}
          </p>
        )}
        {loadState === 'ok' && !error && projects.length === 0 && (
          <div className="rounded border border-line bg-surface p-6 text-center">
            <p className="text-sm text-fgMuted">还没有项目。先在上面的表单添加第一个项目。</p>
            <p className="mt-1 text-xs text-fgFaint">不给假示例数据 —— 0 个就是 0 个。</p>
          </div>
        )}

        {loadState === 'ok' && projects.length > 0 && (
          <>
            {/* 桌面端表格 */}
            <div className="hidden overflow-x-auto rounded-lg border border-line md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-fgFaint">
                    <th className="px-3 py-2">名字</th>
                    <th className="px-3 py-2">类型</th>
                    <th className="px-3 py-2">地址（脱敏）</th>
                    <th className="px-3 py-2">缓存状态</th>
                    <th className="px-3 py-2">新鲜度</th>
                    <th className="px-3 py-2">最近 QA</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const isCurrent = active?.id === p.id;
                    return (
                      <tr key={p.id} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium text-fg">{p.name}</span>
                          {isCurrent && (
                            <span className="ml-2 rounded bg-brass/15 px-1.5 py-0.5 text-2xs text-brass">
                              当前
                            </span>
                          )}
                          <span className="mono ml-2 text-2xs text-fgFaint">{p.id}</span>
                        </td>
                        <td className="px-3 py-2 text-fgMuted">{p.source.kind === 'path' ? '本地目录' : 'git'}</td>
                        <td className="px-3 py-2 text-fgMuted">
                          <span className="break-all text-xs">{p.source.value}</span>
                        </td>
                        <td className="px-3 py-2 text-fgMuted">
                          {p.cache ? (
                            <span className="text-xs">
                              {p.cache.files} 文件 · {humanBytes(p.cache.bytes)}
                              <br />
                              <span className="text-2xs text-fgFaint">摄取于 {shortDate(p.cache.ingestedAt)}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-fgFaint">未摄取</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-fgMuted">
                          <span className="text-xs">未检测</span>
                          <span className="block text-2xs text-fgFaint">列表不比对源头</span>
                        </td>
                        <td className="px-3 py-2 text-fgMuted">
                          <span className="text-xs">{p.lastJobId ? '已提交' : '无'}</span>
                        </td>
                        <td className="px-3 py-2">
                          <RowActions
                            entry={p}
                            isCurrent={isCurrent}
                            onSetCurrent={setCurrent}
                            onOpen={openWith}
                            onDelete={() => setPendingDelete(p)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 移动端卡片行（沿用站点响应式套路：md 以下才显示，不新造） */}
            <div className="space-y-3 md:hidden">
              {projects.map((p) => {
                const isCurrent = active?.id === p.id;
                return (
                  <div key={p.id} className="rounded-lg border border-line bg-surface p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-fg">{p.name}</span>
                      {isCurrent && (
                        <span className="rounded bg-brass/15 px-1.5 py-0.5 text-2xs text-brass">当前</span>
                      )}
                    </div>
                    <p className="mono mt-1 text-2xs text-fgFaint">{p.id}</p>
                    <p className="mt-2 text-xs text-fgMuted">
                      {p.source.kind === 'path' ? '本地目录' : 'git'} · {p.source.value}
                    </p>
                    <p className="mt-1 text-xs text-fgMuted">
                      {p.cache
                        ? `${p.cache.files} 文件 · ${humanBytes(p.cache.bytes)} · 摄取于 ${shortDate(p.cache.ingestedAt)}`
                        : '未摄取'}
                    </p>
                    <div className="mt-3">
                      <RowActions
                        entry={p}
                        isCurrent={isCurrent}
                        onSetCurrent={setCurrent}
                        onOpen={openWith}
                        onDelete={() => setPendingDelete(p)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ④ 底部说明 */}
      <footer className="mt-8 rounded-lg border border-line bg-surface p-5 text-xs leading-relaxed text-fgMuted">
        <h2 className="mb-2 text-sm font-semibold text-fg">关于项目工坊</h2>
        <ul className="space-y-1">
          <li>
            · <span className="text-fg">限额（与扫描同源）</span>：单文件 2MB / 总 500MB / 2 万文件 / 深度 20；超限整份拒绝，不留半份缓存。
          </li>
          <li>
            · <span className="text-fg">缓存位置</span>：<span className="mono">.data/projects/&lt;projectId&gt;/</span>（不进 git）。代码缓存是后续侦察与质检台读的那一份，两个功能页同源。
          </li>
          <li>
            · <span className="text-fg">删除语义</span>：摘出注册表 + 删除本地代码缓存与侦察/体检留档；<span className="text-fg">QA 历史报告（.data/qa/&lt;projectId&gt;/）会保留</span>作为审计痕迹，不会随项目一起消失。
          </li>
          <li>
            · <span className="text-fg">当前项目</span>：记在浏览器 localStorage，是本地偏好；后端离线也能设置，但两个功能页加载时会报离线。
          </li>
        </ul>
      </footer>

      {/* 删除确认框（写清 QA 历史保留） */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5">
            <h3 className="text-sm font-semibold text-fg">删除项目「{pendingDelete.name}」？</h3>
            <p className="mt-2 text-xs leading-relaxed text-fgMuted">
              将摘出注册表、删除本地代码缓存与侦察 / 体检留档。
              <span className="text-fg">QA 历史报告（.data/qa/{pendingDelete.id}/）会保留</span>
              作为审计痕迹 —— 即便项目删了，它的质检台报告依然可查。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded border border-line px-3 py-1.5 text-sm text-fgMuted hover:bg-canvas"
              >
                取消
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="rounded bg-[#E5484D] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowActions({
  entry,
  isCurrent,
  onSetCurrent,
  onOpen,
  onDelete,
}: {
  entry: ProjectEntry;
  isCurrent: boolean;
  onSetCurrent: (e: ProjectEntry) => void;
  onOpen: (e: ProjectEntry, target: '/autopsy' | '/qa') => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {!isCurrent && (
        <button
          type="button"
          onClick={() => onSetCurrent(entry)}
          className="rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
        >
          设为当前
        </button>
      )}
      <button
        type="button"
        onClick={() => onOpen(entry, '/autopsy')}
        className="rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
      >
        打开侦察
      </button>
      <button
        type="button"
        onClick={() => onOpen(entry, '/qa')}
        className="rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
      >
        打开质检台
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
        style={{ color: '#E5484D' }}
      >
        删除
      </button>
    </div>
  );
}

function CurrentBanner({
  active,
  entry,
  detail,
  offline,
  onRefresh,
  onSwitch,
}: {
  active: { id: string; name?: string } | null;
  entry: ProjectEntry | null;
  detail: ProjectDetail | null;
  offline: boolean;
  onRefresh: () => void;
  onSwitch: () => void;
}) {
  if (!active) {
    return (
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-fgMuted">当前项目</h2>
        <p className="text-sm text-fgMuted">尚未选择当前项目。在下方列表点「设为当前」，或添加第一个项目。</p>
      </div>
    );
  }
  const name = active.name ?? entry?.name ?? active.id;
  const src = entry?.source;
  const cache = entry?.cache;
  const fresh = detail?.freshness;
  return (
    <div className="rounded-lg border border-brass/30 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-fgMuted">当前项目</h2>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-fg">
            {name}
            <span className="mono text-2xs font-normal text-fgFaint">{active.id}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitch}
          className="rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
        >
          切换项目
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-fgMuted sm:grid-cols-2">
        <p>
          来源：{src ? (src.kind === 'path' ? '本地目录' : 'git') : '—'}
          {src && <span className="ml-1 break-all text-fgFaint">{src.value}</span>}
        </p>
        <p>
          缓存：
          {cache
            ? `${cache.files} 文件 · ${humanBytes(cache.bytes)} · 摄取于 ${shortDate(cache.ingestedAt)}`
            : '未摄取'}
        </p>
        <p>
          新鲜度：
          {offline
            ? '后端离线，未检测'
            : fresh
              ? freshText(fresh)
              : '未检测（点刷新同步）'}
        </p>
        <p>
          最近扫描：
          {entry?.lastFactsAt ? shortDate(entry.lastFactsAt) : '未扫描'}
        </p>
      </div>
      {!offline && (
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 rounded border border-line px-2 py-1 text-2xs text-fgMuted hover:bg-canvas"
        >
          刷新缓存
        </button>
      )}
    </div>
  );
}

// ── 人话格式化 ──

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function freshText(f: { mode: string; reason?: string; added?: number; updated?: number; removed?: number }): string {
  if (f.mode === 'unscanned') return f.reason ?? '未检测';
  if (typeof f.added === 'number' && typeof f.updated === 'number' && typeof f.removed === 'number') {
    if (f.added + f.updated + f.removed === 0) return '已与源头比对（0 变化）';
    return `源头变化 +${f.added}/~${f.updated}/-${f.removed}`;
  }
  return f.mode;
}
