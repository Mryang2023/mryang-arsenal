/**
 * 生命体征曲线 —— 序列点数组 → 一张手写 SVG。**零依赖**（不引任何图表库，
 * 与 `src/lib/arch-diagram.ts` / `service-graph.ts` 同款纪律）。
 *
 * ─────────────────────────────────────────────────────────────
 * 四条写死了的规矩：
 *
 * ① **确定性**：同输入两次调用必须**逐字节相等**。
 *    所以不要 Date.now()、不要 Math.random()、不要依赖对象 key 的遍历顺序，
 *    所有坐标走 `round2()` 定点两位小数。曲线是可断言的字符串，不是画布。
 * ② **空序列不画空图**：返回 `svg: ''` + 一句人话。
 *    一张「横平竖直、看起来很健康」的空图是最坏的谎 —— 它把「没数据」
 *    说成了「数据不好看」。（本仓 10-04 教训：0 的情况本身是一条结论。）
 * ③ **partial 点不进曲线**：被规模闸门截断的那些点进来会把曲线拉成一个假形状，
 *    而它长得跟真形状一模一样。它们留给列表去说，不进图。
 * ④ **覆盖率分母从数据读**：写死 69 的那天就是它开始撒谎的那天。
 *
 * 输入类型刻意**不 import scripts/lib/vitals-store.mjs**（那是 Node 侧）：这里要能在浏览器
 * 里跑，两边靠同一个 JSON 形状对齐（`pointShapeIssues` 是形状的唯一出处）。
 */

/** 序列点的浏览器侧形状（与 Node 侧 `VitalsPoint` 逐字段对齐）。 */
export interface VitalsSeriesPoint {
  schemaVersion?: number;
  snapshotId?: string;
  ts: string;
  fingerprint?: string;
  fingerprintKind?: 'dir' | 'git' | 'report';
  fingerprintTrust?: boolean;
  fingerprintCaveat?: string;
  verdict?: { p0: number | null; p1: number | null; other: number | null; obs: number | null } | null;
  services?: {
    declarations: number | null;
    entryPoints: number | null;
    units: number | null;
    conflicts: number | null;
  } | null;
  coverage?: { executed: number | null; total: number | null } | null;
  scan?: { files: number; bytes: number; ms: number; truncated: boolean } | null;
  status?: 'full' | 'partial';
  note?: string | null;
  degraded?: string | null;
}

export interface VitalsSeriesOptions {
  width?: number;
  height?: number;
  /** 标题。默认「生命体征」 */
  title?: string;
}

export interface VitalsSeriesLine {
  key: 'p0' | 'services' | 'coverage';
  label: string;
  color: string;
  /** 与 x 轴点位的 y 值序列（null = 这个点没采到，不画不连） */
  values: (number | null)[];
  unit: string;
}

export interface VitalsSeriesResult {
  /** 空数据时是空串 —— 调用方必须先判 `empty`，不许拿默认图顶上 */
  svg: string;
  empty: boolean;
  /** 为什么是空的（人话）。非空时是数据摘要 */
  message: string;
  /** 画进曲线的点数（partial 不计） */
  plotted: number;
  /** 被剔掉的 partial 点数 */
  skippedPartial: number;
  /** 曲线用的分母；没有覆盖率数据时为 null */
  coverageTotal: number | null;
  lines: VitalsSeriesLine[];
  /** x 轴刻度（时间戳原样） */
  labels: string[];
}

export const EMPTY_SERIES_MESSAGE = '还没有序列数据 —— 跑一次 `autopsy-watch once` 才会出现第一个点。';
export const ALL_PARTIAL_MESSAGE = '现有的序列点全是 partial（没采全），按规矩不进曲线。';

const PAD = { left: 46, right: 46, top: 26, bottom: 38 };
const COLOR = {
  grid: '#D6DEDA',
  axis: '#9AA8A2',
  text: '#47524E',
  p0: '#C0392B',
  services: '#7FA650',
  coverage: '#2E6E9E',
};

/** 定点两位小数 —— 确定性的一半靠它（另一半靠不打乱顺序）。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  // 整数不带小数点：同值必须同string，"10" 与 "10.00" 在 diff 里是两次改动
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

/** 可用 = full。partial 一律不进曲线（规矩 ③）。 */
function plottable(p: VitalsSeriesPoint): boolean {
  return (p.status ?? 'full') === 'full';
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 挑 Max：至少留 1，免得全 0 的序列除以 0 得到 NaN 坐标（NaN 在 SVG 里不报错，只是不画）。
 */
function niceMax(values: number[]): number {
  const max = values.reduce((a, b) => (b > a ? b : a), 0);
  if (max <= 0) return 1;
  return max;
}

/**
 * 三条线的取值来源。
 *
 * ★ 第二条线的**标签跟着数据走**：优先画服务单元数（units），
 *   本棒 CLI 采不到 units（服务归属在 TS 侧 `service-topo`，不许在 Node 侧重算），
 *   此时退回服务声明数 —— 但标签必须改成「服务声明」，
 *   **不许拿声明数冒充单元数**（那样图上写着一套、画着另一套）。
 */
function pickLines(points: VitalsSeriesPoint[]): VitalsSeriesLine[] {
  const p0 = points.map((p) => numOrNull(p.verdict?.p0));
  const units = points.map((p) => numOrNull(p.services?.units));
  const decls = points.map((p) => numOrNull(p.services?.declarations));
  const hasUnits = units.some((v) => v !== null);
  const serviceValues = hasUnits ? units : decls;
  const total = points.reduce<number | null>((acc, p) => {
    const t = numOrNull(p.coverage?.total);
    return t !== null ? t : acc;
  }, null);
  const coveragePct = points.map((p) => {
    const ex = numOrNull(p.coverage?.executed);
    const tt = numOrNull(p.coverage?.total);
    if (ex === null || tt === null || tt === 0) return null;
    return round2((ex / tt) * 100);
  });
  return [
    { key: 'p0', label: 'P0 结论', color: COLOR.p0, values: p0, unit: '条' },
    {
      key: 'services',
      label: hasUnits ? '服务单元' : '服务声明',
      color: COLOR.services,
      values: serviceValues,
      unit: '个',
    },
    { key: 'coverage', label: '覆盖率', color: COLOR.coverage, values: coveragePct, unit: '%' },
  ];
}

/**
 * 序列点 → 曲线 SVG。**纯函数，同输入逐字节相等。**
 *
 * @param points 按 ts 升序
 */
export function buildVitalsSeries(
  points: VitalsSeriesPoint[],
  opts: VitalsSeriesOptions = {}
): VitalsSeriesResult {
  const width = opts.width ?? 680;
  const height = opts.height ?? 260;
  const title = opts.title ?? '生命体征';

  const all = Array.isArray(points) ? points : [];
  const usable = all.filter(plottable);
  const skippedPartial = all.length - usable.length;

  if (usable.length === 0) {
    return {
      svg: '',
      empty: true,
      message: all.length === 0 ? EMPTY_SERIES_MESSAGE : ALL_PARTIAL_MESSAGE,
      plotted: 0,
      skippedPartial,
      coverageTotal: null,
      lines: [],
      labels: [],
    };
  }

  const lines = pickLines(usable);
  const labels = usable.map((p) => p.ts);

  // ── 坐标映射 ────────────────────────────────────────────────
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  // 单点：放正中（放在最左会让「只有一个点」看起来像「刚起步」）
  const xOf = (i: number) =>
    usable.length === 1
      ? round2(PAD.left + plotW / 2)
      : round2(PAD.left + (plotW * i) / (usable.length - 1));

  // 左边轴：计数（P0 / 服务）；右边轴：百分比（覆盖率 0–100）
  const countKeys: Array<'p0' | 'services'> = ['p0', 'services'];
  const countValues = lines
    .filter((l) => (countKeys as string[]).includes(l.key))
    .flatMap((l) => l.values.filter((v): v is number => v !== null));
  const countMax = niceMax(countValues);
  const yCount = (v: number) => round2(PAD.top + plotH - (plotH * v) / countMax);
  const yPct = (v: number) => round2(PAD.top + plotH - (plotH * Math.min(v, 100)) / 100);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${title}">`
  );
  out.push(`<title>${title}</title>`);
  out.push(
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF" stroke="#E3E9E6" rx="6"/>`
  );

  // 网格 + 左轴刻度（4 档）
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const frac = i / ticks;
    const y = round2(PAD.top + plotH - plotH * frac);
    out.push(
      `<line x1="${PAD.left}" y1="${y}" x2="${width - PAD.right}" y2="${y}" stroke="${COLOR.grid}" stroke-width="1"/>`
    );
    out.push(
      `<text x="${PAD.left - 8}" y="${round2(y + 3.5)}" text-anchor="end" font-size="10" fill="${COLOR.text}">${fmt(round2(countMax * frac))}</text>`
    );
    out.push(
      `<text x="${width - PAD.right + 8}" y="${round2(y + 3.5)}" text-anchor="start" font-size="10" fill="${COLOR.coverage}">${Math.round(100 * frac)}%</text>`
    );
  }
  // 轴线
  out.push(
    `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${round2(PAD.top + plotH)}" stroke="${COLOR.axis}" stroke-width="1"/>`
  );
  out.push(
    `<line x1="${width - PAD.right}" y1="${PAD.top}" x2="${width - PAD.right}" y2="${round2(PAD.top + plotH)}" stroke="${COLOR.axis}" stroke-width="1"/>`
  );
  out.push(
    `<line x1="${PAD.left}" y1="${round2(PAD.top + plotH)}" x2="${width - PAD.right}" y2="${round2(PAD.top + plotH)}" stroke="${COLOR.axis}" stroke-width="1"/>`
  );

  // ── 三条线 ─────────────────────────────────────────────────
  for (const line of lines) {
    const pts: Array<{ x: number; y: number }> = [];
    line.values.forEach((v, i) => {
      if (v === null) return;
      pts.push({ x: xOf(i), y: line.key === 'coverage' ? yPct(v) : yCount(v) });
    });
    if (pts.length === 0) {
      // 整条线都没采到 —— 画一个「这条线没有数据」的说明，不许画一条 0 线冒充
      out.push(
        `<text x="${PAD.left + 8}" y="${PAD.top + 12}" font-size="11" fill="${COLOR.text}">${line.label}：本序列没有采到过</text>`
      );
      continue;
    }
    if (pts.length >= 2) {
      const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
      out.push(
        `<polyline points="${poly}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      );
    }
    // 点始终画（单点时只有点，没有线 —— 两点才能连成趋势，一条点的「折线」是编出来的趋势）
    for (const p of pts) {
      out.push(`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${line.color}"/>`);
    }
  }

  // ── x 轴标签 ───────────────────────────────────────────────
  const labelStep = usable.length > 6 ? Math.ceil(usable.length / 6) : 1;
  usable.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== usable.length - 1) return;
    const day = String(p.ts).slice(5, 10).replace('-', '/');
    const hhmm = String(p.ts).slice(11, 16);
    out.push(
      `<text x="${xOf(i)}" y="${round2(PAD.top + plotH + 16)}" text-anchor="middle" font-size="10" fill="${COLOR.text}">${day} ${hhmm}</text>`
    );
  });
  out.push(
    `<text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-size="11" fill="${COLOR.text}">` +
      `${usable.length} 个点${skippedPartial > 0 ? `（另有 ${skippedPartial} 个 partial 未进曲线）` : ''}</text>`
  );

  // ── 图例 ───────────────────────────────────────────────────
  let lx = PAD.left;
  for (const line of lines) {
    const last = [...line.values].reverse().find((v) => v !== null);
    out.push(`<rect x="${lx}" y="10" width="10" height="10" fill="${line.color}" rx="2"/>`);
    out.push(
      `<text x="${lx + 14}" y="19" font-size="11" fill="${COLOR.text}">${line.label} ${last === null || last === undefined ? '未采到' : `${fmt(last)}${line.unit}`}</text>`
    );
    lx += 22 + line.label.length * 12 + String(last ?? '').length * 7;
  }

  out.push('</svg>');

  const coverageTotal = lines.length
    ? usable.reduce<number | null>((acc, p) => {
        const t = numOrNull(p.coverage?.total);
        return t !== null ? t : acc;
      }, null)
    : null;

  return {
    svg: out.join('\n'),
    empty: false,
    message: `${usable.length} 个点${skippedPartial > 0 ? `（${skippedPartial} 个 partial 未计）` : ''}`,
    plotted: usable.length,
    skippedPartial,
    coverageTotal,
    lines,
    labels,
  };
}

/** 只想要字符串时用这个（等价于 `buildVitalsSeries(...).svg`，空串表示没数据）。 */
export function buildVitalsSeriesSvg(
  points: VitalsSeriesPoint[],
  opts: VitalsSeriesOptions = {}
): string {
  return buildVitalsSeries(points, opts).svg;
}

/**
 * 逐点的一句话摘要（给列表行用）。**用例：这条组不全时要明说，不许略过。**
 */
export function describeVitalsPoint(p: VitalsSeriesPoint): string {
  const v = p.verdict ?? { p0: null, p1: null, other: null, obs: null };
  const cov =
    !p.coverage || p.coverage.executed === null || p.coverage.total === null
      ? '覆盖率未采到'
      : `覆盖 ${p.coverage.executed}/${p.coverage.total}`;
  const base = `P0 ${v.p0 ?? '未采到'} / P1 ${v.p1 ?? '未采到'} / 观察 ${v.obs ?? '未采到'} · ${cov}`;
  return p.status === 'partial' ? `${base} · ⚠ partial${p.degraded ? `：${p.degraded}` : ''}` : base;
}
