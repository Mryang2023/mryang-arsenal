'use client';

/**
 * 嵌入式案例实验室 —— 最佳实践案例库详情页里的「模拟测试」运行台。
 *
 * 数据来源只有一份：所在蓝图的 playground[] 字段（arsenal-cookbook），
 * 不做任何全局示例摊平 —— 那是合并前独立 /playground 页的旧职责。
 * 后端用 JDK 21 子进程编译并执行，返回 stdout / stderr / 退出码。
 */

import { useEffect, useState } from 'react';
import {
  runCase,
  caseJdk,
  type CaseRunOutcome,
  type CaseJdkOutcome,
  type CaseRunResult,
} from '@/lib/case-run';
import type { PlaygroundDemo, PlaygroundFile } from '@/lib/content-types';
import CodeEditor from '@/components/CodeEditor';

export default function CaseLab({ demos }: { demos: PlaygroundDemo[] }) {
  const [jdk, setJdk] = useState<CaseJdkOutcome | null>(null);
  const [demoId, setDemoId] = useState(demos[0]?.id ?? '');
  const [files, setFiles] = useState<PlaygroundFile[]>(
    demos[0] ? demos[0].files.map((f) => ({ ...f })) : []
  );
  const [activeFile, setActiveFile] = useState(0);
  const [mainClass, setMainClass] = useState(demos[0]?.mainClass ?? 'Main');
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CaseRunOutcome | null>(null);

  useEffect(() => {
    caseJdk().then(setJdk);
  }, []);

  function loadDemo(id: string) {
    const demo = demos.find((d) => d.id === id);
    if (!demo) return;
    setDemoId(id);
    setFiles(demo.files.map((f) => ({ ...f })));
    setActiveFile(0);
    setMainClass(demo.mainClass);
    setOutcome(null);
  }

  function setFileCode(idx: number, code: string) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, code } : f)));
  }

  function setFilePath(idx: number, path: string) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, path } : f)));
  }

  async function handleRun() {
    if (!files.length) return;
    setRunning(true);
    setOutcome(null);
    const result = await runCase({ files, mainClass, timeoutMs }, timeoutMs + 5000);
    setOutcome(result);
    setRunning(false);
  }

  const active = files[activeFile];

  return (
    <div className="space-y-3">
      {/* 多示例切换：蓝图带多个可运行示例时才出现 */}
      {demos.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {demos.map((d) => {
            const on = d.id === demoId;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => loadDemo(d.id)}
                className="mono max-w-full truncate rounded border px-2.5 py-1 text-2xs transition-colors"
                style={{
                  borderColor: on ? 'rgba(217,164,65,0.5)' : '#243029',
                  background: on ? 'rgba(217,164,65,0.09)' : '#131917',
                  color: on ? '#E8F0EC' : '#93A39C',
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}

      {demos[0]?.note && (
        <p className="text-2xs leading-relaxed text-fgMuted">{demos.find((d) => d.id === demoId)?.note ?? demos[0].note}</p>
      )}

      {/* 控制行：入口类 / 超时 / 运行 / JDK 状态 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-2xs text-fgMuted">
          入口类
          <input
            value={mainClass}
            onChange={(e) => setMainClass(e.target.value)}
            className="mono rounded border border-line bg-surface px-2 py-1.5 text-[13px] text-fg outline-none focus:border-brass"
          />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-fgMuted">
          超时(ms)
          <input
            type="number"
            value={timeoutMs}
            min={1000}
            max={300000}
            onChange={(e) =>
              setTimeoutMs(Math.max(1000, Math.min(300000, Number(e.target.value) || 30000)))
            }
            className="mono w-24 rounded border border-line bg-surface px-2 py-1.5 text-[13px] text-fg outline-none focus:border-brass"
          />
        </label>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="rounded-md px-5 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ background: '#D9A441', color: '#0B0F0E' }}
        >
          {running ? '运行中…' : '▶ 运行'}
        </button>
        <span className="mono pb-2 text-2xs">
          {jdk === null && <span className="text-fgFaint">探测运行环境…</span>}
          {jdk?.kind === 'ready' && (
            <span className="text-olive">● JDK {jdk.info.version?.split('"')[1] ?? jdk.info.version}</span>
          )}
          {jdk?.kind === 'offline' && (
            <span style={{ color: '#E5484D' }}>● 后端未连接 —— {jdk.message}</span>
          )}
          {jdk?.kind === 'error' && (
            <span style={{ color: '#E5484D' }}>● 获取失败：{jdk.message}</span>
          )}
        </span>
      </div>

      {/* 多文件标签页 */}
      {files.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setActiveFile(i)}
              className={`mono rounded px-2.5 py-1 text-[12px] transition-colors ${
                i === activeFile ? 'bg-surfaceHi text-fg' : 'bg-surface text-fgMuted hover:text-fg'
              }`}
            >
              {f.path.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      <CodeEditor
        value={active?.code ?? ''}
        onChange={(c) => setFileCode(activeFile, c)}
        className="h-[360px] w-full rounded-md border border-line bg-[#0E1312] focus-within:border-brass"
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 flex-col gap-1 text-2xs text-fgMuted">
          文件名
          <input
            value={active?.path ?? ''}
            onChange={(e) => setFilePath(activeFile, e.target.value)}
            className="mono rounded border border-line bg-surface px-2 py-1.5 text-[13px] text-fg outline-none focus:border-brass"
          />
        </label>
      </div>

      {/* 运行结果 */}
      <div className="space-y-3 pt-1">
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-fgFaint">运行结果</div>
        {!outcome && !running && (
          <div className="grid h-[160px] place-items-center rounded-md border border-dashed border-line text-sm text-fgFaint">
            点「运行」后在这里看编译与执行输出
          </div>
        )}
        {running && (
          <div className="grid h-[160px] place-items-center rounded-md border border-line text-sm text-fgMuted">
            编译并执行中…
          </div>
        )}
        {outcome && outcome.kind === 'offline' && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: '#E5484D55', background: '#E5484D11', color: '#E5484D' }}>
            {outcome.message}
          </div>
        )}
        {outcome && outcome.kind === 'error' && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: '#E5484D55', background: '#E5484D11', color: '#E5484D' }}>
            <div className="mono mb-1">[{outcome.code}]</div>
            {outcome.message}
          </div>
        )}
        {outcome && outcome.kind === 'ran' && <RunResult result={outcome.result} />}
      </div>
    </div>
  );
}

function RunResult({ result }: { result: CaseRunResult }) {
  return (
    <div className="space-y-3">
      {/* 状态行 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className="rounded px-2 py-0.5 font-medium"
          style={{
            background: result.compiled ? 'rgba(127,166,80,0.14)' : 'rgba(229,72,77,0.14)',
            color: result.compiled ? '#7FA650' : '#E5484D',
          }}
        >
          {result.compiled ? '编译通过' : '编译失败'}
        </span>
        <span className="mono rounded bg-surface px-2 py-0.5 text-fgMuted">exit={result.exitCode ?? '—'}</span>
        <span className="mono rounded bg-surface px-2 py-0.5 text-fgMuted">{result.durationMs}ms</span>
        {result.timedOut && (
          <span className="mono rounded bg-surface px-2 py-0.5 text-brass">超时强杀</span>
        )}
        <span className="mono truncate rounded bg-surface px-2 py-0.5 text-fgFaint">
          {result.jdkVersion.split('\n')[0]}
        </span>
      </div>

      {result.stdout && <CodePane label="stdout" tone="out" code={result.stdout} />}
      {result.stderr && <CodePane label="stderr" tone="err" code={result.stderr} />}
      {!result.stdout && !result.stderr && (
        <div className="rounded-md border border-dashed border-line p-4 text-sm text-fgFaint">
          没有输出（程序可能只做了计算或未打印）。
        </div>
      )}
    </div>
  );
}

function CodePane({ label, tone, code }: { label: string; tone: 'out' | 'err'; code: string }) {
  const color = tone === 'err' ? '#E5484D' : '#93A39C';
  return (
    <div className="overflow-hidden rounded-md border bg-[#0E1312]" style={{ borderColor: '#243029' }}>
      <div className="flex items-center justify-between border-b px-3 py-1.5" style={{ borderColor: '#1E2624' }}>
        <span className="mono text-[11px]" style={{ color }}>
          {label}
        </span>
        {tone === 'err' && (
          <span className="mono text-[11px]" style={{ color: '#E58A8D' }}>
            编译 / 运行诊断
          </span>
        )}
      </div>
      <pre
        className="mono max-h-[300px] overflow-auto px-3 py-2.5 text-[12.5px] leading-[1.6]"
        style={{ color: tone === 'err' ? '#E58A8D' : '#E8F0EC' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
