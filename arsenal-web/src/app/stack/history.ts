import { useRef, useState } from 'react';
import type { StackPicks } from '@/lib/content-types';
import type { StackPicksMeta } from '@/lib/topology';

/**
 * 装配台的撤销 / 重做栈（S2-3）。
 *
 * 设计取舍：
 *
 * ① **快照式，不是命令式**。装配台的写操作全部收敛在 { picks, meta, baseId }
 *    三个 state 上（选件 / 形态 / 滑杆 / 基底 / 预设），整份快照不到 1KB，
 *    深拷贝比给每种写操作配 inverse 命令便宜得多，也不会漏。
 *
 * ② **在「写入前」记录**。调用方拿着当前快照调 `record()`，再执行写入 ——
 *    undo 恢复的就是写入前的世界。redo 同理镜像一份 future 栈。
 *
 * ③ **同 tag 合并**。滑杆拖一下触发几十次 setParam，不合并的话 20 步栈
 *    一次拖动就灌满了。连续同 tag 的写入只保留最早那份快照（拖动起点），
 *    undo 一次回到拖动前。
 *
 * ④ **上限 20 步**。栈满后 shift 掉最老的 —— 回退到底之后按钮禁用，
 *    不会出现「点了没反应」的假按钮。
 */

/** 一次可回退的完整状态。三个字段缺一不可：少 baseId 会导致撤销换基底失败 */
export interface StackSnapshot {
  picks: StackPicks;
  meta: StackPicksMeta;
  baseId: string;
}

interface HistoryEntry {
  snap: StackSnapshot;
  /** 连续同 tag 的写入合并成一步（滑杆拖动不把 20 步栈灌满） */
  tag?: string;
}

const LIMIT = 20;

export interface StackHistory {
  /** 可撤销步数（0 = 撤销按钮禁用） */
  undoSteps: number;
  /** 可重做步数（0 = 重做按钮禁用） */
  redoSteps: number;
  /** 写入前调用：把当前快照压进撤销栈，并清空重做栈 */
  record: (snap: StackSnapshot, tag?: string) => void;
  /** 撤销：传入当前快照，返回要恢复的历史快照；栈空返回 null */
  undo: (current: StackSnapshot) => StackSnapshot | null;
  /** 重做：传入当前快照，返回要恢复的未来快照；栈空返回 null */
  redo: (current: StackSnapshot) => StackSnapshot | null;
}

export function useStackHistory(): StackHistory {
  const pastRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  // 步数要在按钮禁用态上实时反映，动一下 tick 触发重渲染
  const [, setTick] = useState(0);

  const record = (snap: StackSnapshot, tag?: string) => {
    const p = pastRef.current;
    const top = p[p.length - 1];
    if (!(tag && top && top.tag === tag)) {
      p.push({ snap, tag });
      if (p.length > LIMIT) p.shift();
    }
    // 一旦有新写入，未来分支作废（与所有编辑器的撤销栈语义一致）
    futureRef.current = [];
    setTick((t) => t + 1);
  };

  const undo = (current: StackSnapshot): StackSnapshot | null => {
    const entry = pastRef.current.pop();
    if (!entry) return null;
    futureRef.current.push({ snap: current });
    setTick((t) => t + 1);
    return entry.snap;
  };

  const redo = (current: StackSnapshot): StackSnapshot | null => {
    const entry = futureRef.current.pop();
    if (!entry) return null;
    pastRef.current.push({ snap: current });
    setTick((t) => t + 1);
    return entry.snap;
  };

  return {
    undoSteps: pastRef.current.length,
    redoSteps: futureRef.current.length,
    record,
    undo,
    redo,
  };
}
