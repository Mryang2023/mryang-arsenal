/**
 * 极简 ZIP 写出器（store 模式，不压缩）。
 *
 * 为什么要自己写：本项目的红线之一是「不引入依赖」，而「导出整包」需要一个 zip。
 * 不压缩的 ZIP 只需要三样东西 —— CRC32、三个固定的结构头、全小端的多字节整数。
 *
 * 三个容易踩的地方（都写在这里，因为调试 zip 格式非常费时间）：
 *   1. 文件名含非 ASCII 时必须置 flags 第 11 位（0x0800），否则解压出来是乱码；
 *   2. 所有多字节整数都是**小端**；
 *   3. 中央目录里的 relOffset 相对**整包起点**，不是相对中央目录。
 *
 * 时间戳固定成 1980-01-01：这让同一份输入产出的字节完全一致，
 * 「同参数两次调用逐字节一致」这条承诺才能覆盖到导出物。
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

/** 标准 CRC-32（IEEE 802.3），与 zip 规范要求的一致 */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 包内路径，用 / 分隔 */
  name: string;
  data: string;
}

const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
/** DOS 日期 1980-01-01：固定值，让输出可复现 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** 把一个 zip 条目列表写成完整的 zip 字节。纯函数：同一输入两次调用逐字节一致。 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.data);
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, METHOD_STORE, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, METHOD_STORE, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
