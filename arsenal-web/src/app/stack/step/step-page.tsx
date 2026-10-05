import type { Metadata } from 'next';
import StackSoftware from '../StackSoftware';
import StackEnv from '../StackEnv';
import StackRun from '../StackRun';
import StackDelivery from '../StackDelivery';
import {
  PAGE_ID_OF_STEP,
  STEP_BY_ID,
  STEP_NO,
  stepIndex,
  type StepId,
  type StackPageId,
} from '../wizard';

/**
 * 步骤级路由的共享容器 —— `/stack/step/<id>` 十条路由的渲染与元信息都在这里，
 * 10 个 `page.tsx` 只各自声明「我是哪一步」。
 *
 * 职责只有一条：把路由给出的步**钉**给对应页面的容器。渲染本身仍归四页容器
 * （P0 四页的信息架构不动）—— 步骤路由是「直达某一步」的入口，不是第五种页面。
 *
 * 钉死的语义见 `useStackChannel` 的 `pinnedStep`：该步由路由给出，不恢复
 * localStorage 里「上次停在哪」；用户在页内继续换步时行为与四页完全一致。
 */

/** 页 id → 页容器。步骤路由只负责「钉到哪一步」，渲染归四页容器 */
const PAGE_CONTAINER: Record<StackPageId, React.ComponentType<{ pinnedStep?: StepId }>> = {
  software: StackSoftware,
  env: StackEnv,
  run: StackRun,
  delivery: StackDelivery,
};

/** 步骤页的元信息：标题带全局序号，描述取该步的问题与影响（同一份出处，不另写文案） */
export function stepPageMeta(id: StepId): Metadata {
  const spec = STEP_BY_ID.get(id);
  const no = spec ? STEP_NO[stepIndex(id)] : '';
  return {
    title: spec ? `装配台 · ${no} ${spec.name}` : '架构装配台',
    description: spec ? `${spec.question} ${spec.feeds}` : '装配台步骤页。',
  };
}

export default function StepPage({ id }: { id: StepId }) {
  const Container = PAGE_CONTAINER[PAGE_ID_OF_STEP[id]];
  return <Container pinnedStep={id} />;
}
