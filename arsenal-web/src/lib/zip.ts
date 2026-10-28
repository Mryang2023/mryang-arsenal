/**
 * 零依赖 ZIP 打包器（store 模式，即不压缩）。
 *
 * 为什么不引 jszip：
 *   这个站点是静态导出（next export），为了打几个纯文本文件而引入一个几十 KB 的
 *   运行时依赖不划算。而且我们要打包的全是源码文本，压缩带来的体积收益远小于
 *   多一个依赖的维护成本。store（method=0）本身就是 ZIP 规范里完全合法的一种模式，
 *   生成的文件在 Windows 资源管理器、macOS 归档工具、unzip 里都能正常打开。
 *
 * 规范要点 —— 下面几处踩过一次就会记一辈子：
 *   ① 多字节字符一律 UTF-8；文件名还必须额外在「通用标志位」上打 bit 11，
 *      否则解压工具会按本地代码页解释文件名，中文名直接变乱码。
 *   ② 所有多字节整数都是小端序（ZIP 是 Intel 时代的格式）。
 *   ③ 中央目录里记录的文件偏移量是相对「整个压缩包的起点」，不是相对第一个文件头。
 *      这一点写错的表现是：能解出第一个文件，后面的全坏。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export { crc32 };

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** MS-DOS 时间戳。ZIP 至今仍在用这个 1980 年起算的格式。 */
function dosStamp(date: Date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

export interface ZipEntry {
  /** 包内路径，一律用正斜杠。目录靠路径隐含，不单独建目录条目。 */
  path: string;
  content: string;
}

export interface ZipResult {
  blob: Blob;
  bytes: number;
  entries: number;
}

/**
 * 把一组文本文件打成 zip，返回原始字节。
 *
 * 输入全部是 UTF-8 文本 —— 这是刻意的：这个打包器只服务于「导出项目源码」，
 * 不需要支持二进制。真需要二进制时应当换成成熟的库，而不是在这里加分支。
 *
 * `date` 显式传入固定值（如 `new Date(1980, 0, 1)`）即可得到逐字节确定的输出 ——
 * 「同输入两次导出必须一致」这条承诺（.verify/case-check）就是靠它成立的。
 */
export function buildZipBytes(entries: ZipEntry[], date: Date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(date);

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path.replace(/\\/g, '/'));
    const dataBytes = encoder.encode(entry.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = concat([
      u32(0x04034b50), // 本地文件头签名
      u16(20), // 解压所需版本
      u16(0x0800), // 通用标志位：bit 11 = 文件名是 UTF-8
      u16(0), // 压缩方法 0 = store
      u16(stamp.time),
      u16(stamp.day),
      u32(crc),
      u32(size), // 压缩后大小（store 模式下等于原始大小）
      u32(size),
      u16(nameBytes.length),
      u16(0), // 扩展字段长度
      nameBytes,
    ]);

    chunks.push(local, dataBytes);

    central.push(
      concat([
        u32(0x02014b50), // 中央目录条目签名
        u16(20), // 创建者版本
        u16(20), // 解压所需版本
        u16(0x0800),
        u16(0),
        u16(stamp.time),
        u16(stamp.day),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0), // 扩展字段
        u16(0), // 注释
        u16(0), // 起始磁盘号
        u16(0), // 内部属性
        u32(0o100644 << 16), // 外部属性：普通文件权限，解压后不会变成可执行
        u32(offset),
        nameBytes,
      ])
    );

    offset += local.length + dataBytes.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50), // 中央目录结束记录
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0), // 注释长度
  ]);

  const all = concat([...chunks, centralBytes, end]);
  return all;
}

/** 字节的 Blob 包装（界面下载用）。 */
export function buildZip(entries: ZipEntry[], date: Date = new Date()): ZipResult {
  const all = buildZipBytes(entries, date);
  return {
    blob: new Blob([all], { type: 'application/zip' }),
    bytes: all.length,
    entries: entries.length,
  };
}

/** 触发浏览器下载。返回包体积，供界面反馈用。 */
export function downloadZip(entries: ZipEntry[], filename: string): number {
  const { blob, bytes } = buildZip(entries);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 会让部分浏览器来不及取数据，延迟释放
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return bytes;
}

/**
 * 下载单个文本文件（SVG / Markdown / DSL 源码）。
 *
 * 与 zip 同一条自我约束：只处理文本。SVG 之所以能走这条路，正是因为它
 * 是「图形 + 文本」而不是 canvas —— 一份能进 Git、能 diff、能被 IDE 预览的图。
 */
export function downloadText(content: string, filename: string, mime = 'text/plain'): number {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return blob.size;
}
