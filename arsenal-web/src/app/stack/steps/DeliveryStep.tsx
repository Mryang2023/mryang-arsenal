'use client';

import type { ArchAudit } from '@/lib/arch';
import type { StackPicksMeta } from '@/lib/topology';
import type { ComposedStack, StackPicks } from '@/lib/content-types';
import { STEP_BY_ID } from '../wizard';
import DeliveryDeck from '../DeliveryDeck';
import StepShell from './StepShell';

/**
 * ⑦ 交付 —— 九块实时预览独占一屏。
 *
 * 原来它被挤在装配台右栏（一半宽度、跟着台面一起滚），九块预览挤成两列，
 * 而且必须和 33 个槽位抢注意力。交付是**这一趟的终点**，值得单独一屏：
 * 目录树、架构图、形态图、依赖图、隐患单、容量账、部署清单全在这里，
 * 下面紧接着就是产物文件与一键导出。
 */
export default function DeliveryStep({
  picks,
  meta,
  audit,
  composed,
  baseId,
  onParam,
  focusTab,
  onFocusConsumed,
}: {
  picks: StackPicks;
  meta: StackPicksMeta;
  audit: ArchAudit;
  composed: ComposedStack;
  baseId: string;
  onParam: (key: string, value: number) => void;
  focusTab: 'arch' | null;
  onFocusConsumed: () => void;
}) {
  const spec = STEP_BY_ID.get('delivery')!;
  return (
    <StepShell spec={spec}>
      <div className="p-4">
        <DeliveryDeck
          picks={picks}
          meta={meta}
          audit={audit}
          composed={composed}
          baseId={baseId}
          onParam={onParam}
          focusTab={focusTab}
          onFocusConsumed={onFocusConsumed}
        />
      </div>
    </StepShell>
  );
}
