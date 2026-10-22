'use client';

/**
 * 项目档案 —— 「项目自己记了什么」。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 与 /autopsy 的分工（别在页面里重写任何一条）
 *
 *   /autopsy 回答「代码是什么样」—— 技术栈、分层、服务拓扑、体检结论。
 *   本页   回答「项目承诺了什么」—— 开发章程、变更历史、表结构说明、DDL。
 *
 * 两边都不自己算：档案由后端 `GET /api/projects/{id}/dossier` 从项目缓存索引，
 * 正文由 `GET /{id}/doc` 按需取。本页只负责把「有没有写」摆出来 ——
 * 缺文档不是错误，是**一条结论**。
 *
 * 三条刻意的做法：
 *   ① 表说明优先于实体：同一张表两边都有时，列取人写的那份（能写清枚举、单位、
 *      索引意图）；实体只补类名。反过来的话，人写的东西永远被代码盖掉。
 *   ② 「有表没文档」不做成过滤条件，做成列上的标记 + 顶部缺口计数。藏起来的话，
 *      四件套缺了哪一件就永远看不见。
 *   ③ 章程只按节目录取一段渲染，不把 2400 行整份塞进 DOM —— 整份渲染会让
 *      页签切换明显卡顿，而读者一次只看一节。
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useActiveProject } from '@/lib/active-project';
import {
  getProject,
  getProjectDossier,
  getProjectDoc,
  type Dossier,
  type DossierTable,
} from '@/lib/projects-api';
// 校验页签单独成文件：它有自己的取数（verify + plans），与档案响应无关。
import AuditTab from './AuditTab';
// 模块开发看板同理：七步打法要按模块聚合，档案响应里没有这份数据。
import ModuleBoardTab from './ModuleBoardTab';

type Tab = 'overview' | 'modules' | 'tables' | 'changes' | 'charter' | 'scripts' | 'audit';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; data: Dossier }
  | { kind: 'failed'; code?: string; message: string; offline?: boolean };

const TABS: [Tab, string][] = [
  ['overview', '概览'],
  ['modules', '模块开发'],
  ['tables', '数据字典'],
  ['changes', '变更历史'],
  ['charter', '开发章程'],
  ['scripts', 'DDL 脚本'],
  ['audit', '四件套校验'],
];

export default function DossierConsole() {
  const active = useActiveProject();
  const pid = active?.id ?? null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('overview');
  const [tableKey, setTableKey] = useState<string>('');
  const [scriptPath, setScriptPath] = useState<string>('');
  const [doc, setDoc] = useState<{ path: string; text: string } | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [outlineIndex, setOutlineIndex] = useState(0);
  const [projName, setProjName] = useState<string | null>(null);

  // ── 档案索引 ──
  useEffect(() => {
    if (!pid) {
      setLoad({ kind: 'failed', message: '还没有当前项目。先去「项目管理」选一个。' });
      return;
    }
    let alive = true;
    setLoad({ kind: 'loading' });
    getProjectDossier(pid).then((o) => {
      if (!alive) return;
      if (o.kind === 'ok') setLoad({ kind: 'ok', data: o.data });
      else if (o.kind === 'offline') setLoad({ kind: 'failed', message: o.message, offline: true });
      else setLoad({ kind: 'failed', code: o.code, message: o.message });
    });
    getProject(pid).then((o) => {
      if (alive && o.kind === 'ok') setProjName(o.data.name);
    });
    return () => {
      alive = false;
    };
  }, [pid]);

  const dossier = load.kind === 'ok' ? load.data : null;

  // ── 表：默认选第一张 ──
  const tables = dossier?.db.tables ?? [];
  const currentTable = useMemo(() => {
    if (!tables.length) return null;
    return tables.find((t) => t.table === tableKey) ?? tables[0];
  }, [tables, tableKey]);

  // ── 文档按需取：章程 / 脚本共用一条通道 ──
  const readDoc = useCallback(
    (path: string) => {
      if (!pid) return;
      setDocError(null);
      setDoc((cur) => (cur?.path === path ? cur : null));
      getProjectDoc(pid, path).then((o) => {
        if (o.kind === 'ok') setDoc({ path, text: o.data.content });
        else setDocError(o.kind === 'offline' ? o.message : `${o.code}：${o.message}`);
      });
    },
    [pid],
  );

  useEffect(() => {
    if (tab === 'charter' && dossier?.charter.found && dossier.charter.file && dossier.charter.readable) {
      readDoc(dossier.charter.file);
    }
  }, [tab, dossier, readDoc]);

  // 脚本页的「选中项」= 用户点的那份，否则第一份。
  // ★ 必须在这里算出 eff 并**真的去读**：早先只在渲染时 `scriptPath || scripts[0]`
  //   兜底、effect 却判 `scriptPath`，于是从章程切过来时一次也没读脚本 ——
  //   面板里留着上一份文档（章程），标题写着 .sql。同一份 state 两个出口各自兜底
  //   就会这样静默错位。
  const scriptList = dossier?.db.scripts ?? [];
  const effScript = scriptPath || scriptList[0]?.file || '';
  useEffect(() => {
    if (tab === 'scripts' && effScript) readDoc(effScript);
  }, [tab, effScript, readDoc]);

  // ── 渲染 ──

  if (!active) {
    return (
      <main className="flex-1 px-5 py-8 md:px-8">
        <h1 className="text-xl font-medium text-fg">项目档案</h1>
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-fgMuted">
          还没有当前项目。<Link href="/projects" className="text-brass underline">去项目管理选一个</Link>，
          档案会按那个项目的缓存来读。
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 px-5 py-8 md:px-8">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-medium text-fg">项目档案</h1>
        <span className="text-xs text-fgMuted">
          当前项目自己记了什么：开发章程、数据库变更历史、表结构说明、DDL 脚本与表→实体映射。
        </span>
      </header>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fgMuted">
        <div>
          <dt className="inline text-fgFaint">项目 </dt>
          <dd className="inline">{projName ?? active.name ?? active.id}</dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">projectId </dt>
          <dd className="inline font-mono">{active.id}</dd>
        </div>
        {dossier && (
          <div>
            <dt className="inline text-fgFaint">索引时间 </dt>
            <dd className="inline font-mono">{fmtStamp(dossier.indexedAt)}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-fgFaint">作用范围 </dt>
          <dd className="inline">项目缓存内 docs/ 与 @TableName，只读，不执行 SQL</dd>
        </div>
      </dl>

      {load.kind === 'loading' && (
        <p className="mt-5 text-sm text-fgMuted">正在索引项目缓存里的文档…</p>
      )}

      {load.kind === 'failed' && (
        <div className="mt-5 panel px-4 py-4">
          <p className="text-sm text-fg">{load.message}</p>
          {load.code === 'NOT_FOUND' && (
            <p className="mt-2 text-xs text-fgMuted">
              这不是故障：项目还没摄取缓存，或者项目已经被删了。去
              <Link href="/projects" className="text-brass underline"> 项目管理 </Link>
              刷新一次缓存再回来。
            </p>
          )}
          {load.offline && (
            <p className="mt-2 text-xs text-fgMuted">
              档案页需要后端 :3011。起服务的命令：<code className="mono">bash arsenal-server/scripts/run.sh</code>
            </p>
          )}
        </div>
      )}

      {dossier && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-1 self-start rounded border border-line p-0.5">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={
                  'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                  (tab === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                {label}
                {id === 'tables' && `（${dossier.stats.tables}）`}
                {id === 'changes' && `（${dossier.stats.changelogEntries}）`}
                {id === 'scripts' && `（${dossier.stats.scripts}）`}
              </button>
            ))}
          </div>

          {!dossier.available && (
            <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
              项目缓存不存在 —— 档案为空。去「项目管理」刷新一次缓存。
            </p>
          )}

          {dossier.available && tab === 'overview' && <Overview dossier={dossier} />}
          {dossier.available && tab === 'tables' && (
            <TablesTab tables={tables} current={currentTable} onPick={setTableKey} />
          )}
          {dossier.available && tab === 'changes' && <ChangesTab dossier={dossier} />}
          {dossier.available && tab === 'charter' && (
            <CharterTab
              dossier={dossier}
              doc={doc}
              error={docError}
              index={outlineIndex}
              onPick={(i) => setOutlineIndex(i)}
            />
          )}
          {dossier.available && tab === 'scripts' && (
            <ScriptsTab
              scripts={scriptList}
              path={effScript}
              onPick={setScriptPath}
              doc={doc}
              error={docError}
            />
          )}
          {/* 看板自己取数：/modules 聚合了四件套、Controller 与文档对账，不依赖上面的档案响应。 */}
          {tab === 'modules' && <ModuleBoardTab pid={active.id} />}
          {/* 审计自己取数：verify 走 dossier.build，计划走 /ddl/plans —— 都不依赖上面的档案响应。 */}
          {tab === 'audit' && <AuditTab pid={active.id} />}
        </>
      )}
    </main>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 概览：四件套做到了几件
// ═══════════════════════════════════════════════════════════════════

function Overview({ dossier }: { dossier: Dossier }) {
  const s = dossier.stats;
  // 模板不算「有脚本」：docs/db/templates/ 里那份是给人抄的骨架，
  // 它存在恰恰说明**还没有**一次真实的结构变更落过盘。混着数会把红灯数成绿灯。
  const templates = dossier.db.scripts.filter((x) => x.template).length;
  const realScripts = dossier.db.scripts.length - templates;
  const items = [
    {
      key: 'sql',
      label: '可执行 SQL 脚本',
      ok: realScripts > 0,
      warn: realScripts === 0 && templates > 0,
      detail:
        realScripts > 0
          ? `${realScripts} 份${templates ? `（另有模板 ${templates} 份）` : ''}`
          : templates > 0
            ? `只有模板 ${templates} 份，还没有正式变更脚本`
            : '没有 docs/db/**/*.sql',
    },
    {
      key: 'changelog',
      label: '变更日志',
      ok: s.changelogEntries > 0,
      detail: dossier.db.changelog.found
        ? `${s.changelogEntries} 条记录${dossier.db.changelog.skippedRows ? `，${dossier.db.changelog.skippedRows} 行列数不足未计入` : ''}`
        : '没有 docs/db/CHANGELOG.md',
    },
    {
      key: 'tables',
      label: '表结构说明',
      ok: s.tables > 0 && s.tablesUndocumented === 0,
      warn: s.tables > 0 && s.tablesUndocumented > 0,
      detail: `${s.tablesDocumented} / ${s.tables} 张表有说明`,
    },
    {
      key: 'entity',
      label: '实体类',
      ok: s.entities > 0,
      detail: `${s.entities} 个 @TableName 实体`,
    },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <div key={it.key} className="panel px-3 py-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: it.ok ? '#7FA650' : it.warn ? '#E5A33D' : '#E5484D' }}
              />
              <span className="text-[11px] font-semibold text-fg">{it.label}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-fgMuted">{it.detail}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel px-3 py-3">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">档案索引</p>
          <dl className="mt-2 space-y-1 text-[11.5px] text-fgMuted">
            <Row k="表" v={`${s.tables} 张`} />
            <Row k="有表说明" v={`${s.tablesDocumented} 张`} />
            <Row k="只有实体（缺说明）" v={`${s.tablesUndocumented} 张`} />
            <Row k="变更记录" v={`${s.changelogEntries} 条`} />
            <Row k="DDL 脚本" v={`${s.scripts} 份`} />
            <Row k="实体映射" v={`${s.entities} 个`} />
            <Row k="章程" v={dossier.charter.found ? `${dossier.charter.lines ?? 0} 行 / ${dossier.charter.outline.length} 节` : '未找到'} />
          </dl>
        </div>

        <div className="panel px-3 py-3">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">解析说明</p>
          {dossier.notes.length === 0 ? (
            <p className="mt-2 text-[11.5px] text-fgMuted">没有需要说明的异常。</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed">
              {dossier.notes.map((n, i) => (
                <li key={i} className={n.level === 'warn' ? 'text-fg' : 'text-fgMuted'}>
                  <span className="mono mr-1 text-[10px] text-fgFaint">{n.code}</span>
                  {n.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-fgFaint">{k}</dt>
      <dd className="min-w-0 break-all text-right">{v}</dd>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 数据字典
// ═══════════════════════════════════════════════════════════════════

function TablesTab({
  tables,
  current,
  onPick,
}: {
  tables: DossierTable[];
  current: DossierTable | null;
  onPick: (t: string) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tables;
    return tables.filter(
      (t) => t.table.toLowerCase().includes(s) || (t.title || '').toLowerCase().includes(s) || (t.entityClass || '').toLowerCase().includes(s),
    );
  }, [tables, q]);

  if (!tables.length) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        没有找到任何表：既没有 docs/db/tables/*.md，也没有 @TableName 实体。
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="panel flex max-h-[70vh] flex-col overflow-hidden">
        <div className="border-b border-line p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索表名 / 中文名 / 实体"
            className="w-full rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-fg outline-none placeholder:text-fgFaint"
          />
          <p className="mt-1.5 text-[10px] text-fgFaint">
            {filtered.length} / {tables.length} 张 · 实心点 = 有表说明
          </p>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {filtered.map((t) => (
            <li key={t.table}>
              <button
                type="button"
                onClick={() => onPick(t.table)}
                className={
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition-colors ' +
                  (current?.table === t.table ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: t.documented ? '#7FA650' : 'rgba(255,255,255,0.18)' }}
                  title={t.documented ? '有表说明' : '只有实体，没有表说明'}
                />
                <span className="mono truncate">{t.table}</span>
                {t.title && <span className="truncate text-[10px] text-fgFaint">{t.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 space-y-3">
        {current && <TableDetail t={current} />}
      </div>
    </div>
  );
}

function TableDetail({ t }: { t: DossierTable }) {
  return (
    <>
      <div className="panel px-3 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="mono text-sm text-fg">{t.table}</h2>
          {t.title && <span className="text-xs text-fgMuted">{t.title}</span>}
          <span
            className="rounded px-1.5 py-0.5 text-[10px]"
            style={
              t.documented
                ? { background: 'rgba(127,166,80,0.12)', color: '#7FA650' }
                : { background: 'rgba(229,163,61,0.12)', color: '#E5A33D' }
            }
          >
            {t.documented ? '有表说明' : '缺表说明'}
          </span>
        </div>
        {/* 单列：实体文件是长路径，两列并排会把相邻那格的标签挤到路径尾巴上 */}
        <dl className="mt-2 space-y-1 text-[11px] text-fgMuted">
          <Row k="说明文件" v={t.file || '（没有）'} />
          <Row k="实体类" v={t.entityClass || '（没有）'} />
          <Row k="实体文件" v={t.entityFile || '—'} />
          <Row k="继承" v={t.entityExtends || '—'} />
        </dl>
        {!t.documented && (
          <p className="mt-2 rounded border border-dashed border-line px-2.5 py-2 text-[11px] leading-relaxed text-fgMuted">
            这张表还没有 docs/db/tables/{t.table}.md。下面的列是从 Java 字段反推的 ——
            <b className="text-fg"> SQL 类型、可空、默认值、索引都无从得知</b>，注释也可能不全。
            {t.entityExtends && (
              <>
                {' '}实体还继承了 <code className="mono">{t.entityExtends}</code>，
                <b className="text-fg">它带来的公共字段不在上表里</b>。
              </>
            )}
            {' '}按四件套补一份表说明后，这里会自动换成文档里的内容。
          </p>
        )}
        {t.basic && Object.keys(t.basic).length > 0 && (
          <dl className="mt-2 space-y-1 text-[11px] text-fgMuted">
            {Object.entries(t.basic).map(([k, v]) => (
              <Row key={k} k={k} v={v || '—'} />
            ))}
          </dl>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-line px-3 py-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            字段清单（{t.columns.length}）
          </p>
        </div>
        <div className="max-h-[52vh] overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-surfaceHi text-fgFaint">
              <tr>
                {['#', '字段', '类型', '可空', '默认值', '注释', '枚举/单位', '索引', 'Java 字段', 'Java 类型'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.columns.map((c) => (
                <tr key={`${c.no}-${c.name}`} className="border-b border-line/60">
                  <td className="px-2 py-1.5 text-fgFaint">{c.no}</td>
                  <td className="mono whitespace-nowrap px-2 py-1.5 text-fg">{c.name}</td>
                  <td className="mono whitespace-nowrap px-2 py-1.5 text-fgMuted">{c.type}</td>
                  <td className="px-2 py-1.5 text-fgMuted">{c.nullable || '—'}</td>
                  <td className="mono px-2 py-1.5 text-fgMuted">{c.defaultValue || '—'}</td>
                  <td className="px-2 py-1.5 text-fgMuted">{c.comment || '—'}</td>
                  <td className="px-2 py-1.5 text-fgMuted">{c.enumOrUnit || '—'}</td>
                  <td className="mono px-2 py-1.5 text-fgMuted">{c.index || '—'}</td>
                  <td className="mono px-2 py-1.5 text-fgMuted">{c.javaField || '—'}</td>
                  <td className="mono px-2 py-1.5 text-fgMuted">{c.javaType || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {t.indexes.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="border-b border-line px-3 py-2">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">索引清单（{t.indexes.length}）</p>
          </div>
          <table className="w-full border-collapse text-[11px]">
            <thead className="bg-surfaceHi text-fgFaint">
              <tr>
                {['索引名', '类型', '字段顺序', '用途'].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-1.5 text-left font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.indexes.map((x, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="mono px-2 py-1.5 text-fg">{x.name}</td>
                  <td className="px-2 py-1.5 text-fgMuted">{x.type}</td>
                  <td className="mono px-2 py-1.5 text-fgMuted">{x.fields}</td>
                  <td className="px-2 py-1.5 text-fgMuted">{x.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 变更历史
// ═══════════════════════════════════════════════════════════════════

function ChangesTab({ dossier }: { dossier: Dossier }) {
  const cl = dossier.db.changelog;
  if (!cl.found) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        没有 docs/db/CHANGELOG.md —— 数据库变更没有留档。按开发章程 2.15，每次结构变更都要追加一条。
      </p>
    );
  }
  const entries = cl.entries ?? [];
  if (!entries.length) {
    return <p className="mt-4 text-sm text-fgMuted">CHANGELOG 存在，但「变更记录」表里还没有数据行。</p>;
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] text-fgMuted">
        共 {cl.count} 条，按文件顺序（新记录追加在表尾）。
      </p>
      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 bg-surfaceHi text-fgFaint">
            <tr>
              {['日期', '脚本', '表', '操作', '变更后', '原因', '影响/兼容', '回滚', '执行环境/结果', '表说明', '实体'].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="mono whitespace-nowrap px-2 py-1.5 text-fg">{e.date}</td>
                <td className="mono px-2 py-1.5 text-fgMuted">{e.script}</td>
                <td className="mono px-2 py-1.5 text-fg">{e.table}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.operation}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.after}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.reason}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.impact}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.rollback}</td>
                <td className="px-2 py-1.5 text-fgMuted">{e.envResult}</td>
                <td className="mono px-2 py-1.5 text-fgMuted">{e.tableDoc}</td>
                <td className="mono px-2 py-1.5 text-fgMuted">{e.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 开发章程
// ═══════════════════════════════════════════════════════════════════

function CharterTab({
  dossier,
  doc,
  error,
  index,
  onPick,
}: {
  dossier: Dossier;
  doc: { path: string; text: string } | null;
  error: string | null;
  index: number;
  onPick: (i: number) => void;
}) {
  const ch = dossier.charter;

  // hook 必须在任何 return 之前（章程有没有、超没超限都会随项目切换变化）：
  // 提前 return 再挂 useMemo，切项目时 hook 数量一变，React 会直接抛错。
  const outline = useMemo(
    () => (ch.outline.length ? ch.outline : [{ level: 1, title: '章程全文', line: 1 }]),
    [ch.outline],
  );
  // 只认「这份文档」：共用 doc 通道时，上一份（比如刚看过的 .sql）不许借位渲染
  const own = doc && doc.path === ch.file ? doc : null;
  const ok = own !== null;
  const lines = own ? own.text.split(/\r?\n/) : null;
  const cur = Math.min(index, outline.length - 1);
  const item = outline[cur];
  const section = useMemo(() => {
    if (!lines || !item) return '';
    let end = lines.length;
    for (let i = cur + 1; i < outline.length; i++) {
      if (outline[i].level <= item.level) {
        end = outline[i].line - 1;
        break;
      }
    }
    return lines.slice(Math.max(0, item.line - 1), end).join('\n');
  }, [lines, item, cur, outline]);

  if (!ch.found) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        没有找到开发章程。约定路径是 <code className="mono">docs/开发章程.md</code>。
      </p>
    );
  }
  if (!ch.readable) {
    return (
      <p className="mt-4 text-sm text-fgMuted">
        章程 {ch.file} 超过单份上限，只索引了目录（{ch.outline.length} 节），不提供全文。
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="panel flex max-h-[74vh] flex-col overflow-hidden">
        <div className="border-b border-line px-3 py-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            目录（{ch.outline.length} 节）
          </p>
          <p className="mt-1 text-[10px] text-fgFaint">
            {ch.file} · {ch.lines} 行
          </p>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {outline.map((h, i) => (
            <li key={`${h.line}-${i}`}>
              <button
                type="button"
                onClick={() => onPick(i)}
                className={
                  'flex w-full gap-1.5 px-2.5 py-1 text-left text-[11px] leading-snug transition-colors ' +
                  (i === index ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
                style={{ paddingLeft: 10 + (h.level - 1) * 10 }}
              >
                <span className="mono shrink-0 text-[9px] text-fgFaint">{h.line}</span>
                <span className="truncate">{h.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel min-w-0 overflow-auto">
        <div className="border-b border-line px-4 py-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            {item ? `第 ${item.line}–${item.line + Math.max(0, section.split('\n').length - 1)} 行` : '正文'}
          </p>
        </div>
        <div className="max-h-[70vh] overflow-auto px-4 py-3">
          {error && <p className="text-sm text-fg">{error}</p>}
          {!error && !ok && <p className="text-sm text-fgMuted">正在读取章程…</p>}
          {!error && ok && <Markdown text={section} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DDL 脚本
// ═══════════════════════════════════════════════════════════════════

function ScriptsTab({
  scripts,
  path,
  onPick,
  doc,
  error,
}: {
  scripts: Dossier['db']['scripts'];
  path: string;
  onPick: (p: string) => void;
  doc: { path: string; text: string } | null;
  error: string | null;
}) {
  if (!scripts.length) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        没有找到 docs/db/**/*.sql —— 数据库变更没有可执行脚本。
      </p>
    );
  }
  const own = doc && doc.path === path ? doc : null;
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="panel max-h-[74vh] overflow-auto">
        <div className="border-b border-line px-3 py-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">脚本（{scripts.length}）</p>
          <p className="mt-1 text-[10px] text-fgFaint">只展示，不执行</p>
        </div>
        <ul className="py-1">
          {scripts.map((s) => (
            <li key={s.file}>
              <button
                type="button"
                onClick={() => onPick(s.file)}
                className={
                  'w-full px-3 py-1.5 text-left text-[11px] leading-snug transition-colors ' +
                  (s.file === path ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                <span className="mono block truncate">{s.file}</span>
                <span className="mt-0.5 block text-[10px] text-fgFaint">
                  {s.template ? '模板 · ' : ''}
                  {s.lines} 行 · {s.statements} 条语句
                  {s.tables.length ? ` · ${s.tables.join('、')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel min-w-0 overflow-auto">
        <div className="border-b border-line px-3 py-2">
          {/* 路径保持原样：套 CSS uppercase 会把 docs/ 显示成 DOCS/，路径一改就不是路径了 */}
          <p className="mono text-[10px] tracking-wider text-fgFaint">{path || '选择一份脚本'}</p>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {error && <p className="px-3 py-3 text-sm text-fg">{error}</p>}
          {!error && !own && <p className="px-3 py-3 text-sm text-fgMuted">正在读取脚本…</p>}
          {!error && own && (
            <pre className="whitespace-pre-wrap break-words px-3 py-3 font-mono text-[11px] leading-relaxed text-fgMuted">
              {own.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 极简 Markdown 渲染（标题 / 列表 / 表格 / 代码块 / 引用）
// ═══════════════════════════════════════════════════════════════════

type MdBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'table'; head: string[]; rows: string[][] };

function parseMd(src: string): MdBlock[] {
  const lines = src.split(/\r?\n/);
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === '') {
      i++;
      continue;
    }
    const fence = l.match(/^\s*```/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push({ t: 'code', text: buf.join('\n') });
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ t: 'h', level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    if (/^\s*\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      const sep = rows[1] && rows[1].every((c) => /^:?-{3,}:?$/.test(c.trim()));
      const head = sep ? rows[0] : [];
      const body = sep ? rows.slice(2) : rows;
      out.push({ t: 'table', head, rows: body });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      out.push({ t: 'ul', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push({ t: 'ol', items });
      continue;
    }
    if (/^\s*>/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: buf.join(' ') });
      continue;
    }
    const buf: string[] = [l.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(#{1,6}\s|```|\||[-*+]\s|\d+[.)]\s|>)/.test(lines[i])
    ) {
      buf.push(lines[i++].trim());
    }
    out.push({ t: 'p', text: buf.join(' ') });
  }
  return out;
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.endsWith('|')) t = t.slice(0, -1);
  if (t.startsWith('|')) t = t.slice(1);
  return t.split('|').map((c) => c.trim());
}

function Inline({ text }: { text: string }) {
  // 行内认两种：`代码` 与 [文字](地址)。链接只留文字 —— 章程的目录是
  // `[0. 使用说明](#0-使用说明)` 这种站内锚点，切片视图里点它没有落点，
  // 做成可点的外观等于给了一个假按钮。
  const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]*\))/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[^\]]+\]\([^)]*\)$/.test(p) ? (
          <span key={i}>{p.slice(1, p.indexOf(']'))}</span>
        ) : p.startsWith('`') && p.endsWith('`') && p.length > 1 ? (
          <code key={i} className="mono rounded bg-surfaceHi px-1 py-0.5 text-[10.5px] text-brass">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMd(text), [text]);
  return (
    <div className="space-y-2 text-[12px] leading-relaxed text-fgMuted">
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          const size = b.level === 1 ? 'text-base' : b.level === 2 ? 'text-sm' : 'text-[12.5px]';
          return (
            <h3 key={i} className={`${size} mt-3 font-semibold text-fg`}>
              <Inline text={b.text} />
            </h3>
          );
        }
        if (b.t === 'code') {
          return (
            <pre key={i} className="mono overflow-auto rounded border border-line bg-surfaceHi px-2.5 py-2 text-[10.5px] leading-relaxed">
              {b.text}
            </pre>
          );
        }
        if (b.t === 'ul' || b.t === 'ol') {
          const Tag = b.t === 'ul' ? 'ul' : 'ol';
          return (
            <Tag key={i} className={b.t === 'ul' ? 'list-disc space-y-0.5 pl-5' : 'list-decimal space-y-0.5 pl-5'}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </Tag>
          );
        }
        if (b.t === 'quote') {
          return (
            <blockquote key={i} className="border-l-2 border-line pl-3 text-fgFaint">
              <Inline text={b.text} />
            </blockquote>
          );
        }
        if (b.t === 'table') {
          return (
            <div key={i} className="overflow-auto">
              <table className="w-full border-collapse text-[11px]">
                {b.head.length > 0 && (
                  <thead className="bg-surfaceHi text-fgFaint">
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className="border-b border-line px-2 py-1 text-left font-normal">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-line/60 align-top">
                      {r.map((c, k) => (
                        <td key={k} className="px-2 py-1">
                          <Inline text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════

function fmtStamp(iso: string): string {
  if (!iso) return '（未记录）';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
