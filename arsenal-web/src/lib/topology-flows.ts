import raw from '@/generated/topology-flows.json';
import type { TopologyFlow, TopologyFlowDoc, TopologyFlowSceneId } from './content-types';

/**
 * 部署形态机理剧本的前端入口 —— 「加一类事实源改四处」里属于前端 resolver 的那一处。
 *
 * 数据链路：tools/content/stack_topology_flows.py（事实源，改内容改这里）
 *   → tools/build-content.py（构建期校验）→ arsenal-stacks/topology_flows.json
 *   → scripts/sync-content.mjs（同步 + 独立校验）→ src/generated/topology-flows.json
 *   → 本文件（唯一消费入口）。
 *
 * 三条使用纪律：
 *   ① 查不到就返回 null，调用方自己处理 —— 不许在这里兜底造一个默认剧本，
 *      「看起来有剧本、其实不是这个形态」比没有剧本更糟；
 *   ② 「有没有剧本」决定形态卡上出不出现「▷ 看机理」按钮（TopologyPicker），
 *      剧本没写的形态（如 P0-1 时的哨兵 / Cluster）就是无按钮的如实空态；
 *   ③ 字段类型在 content-types.ts，两边由【16】字段契约与【22】层双向看管。
 */
export const topologyFlows = raw as unknown as TopologyFlowDoc;

/** 场景三问的展示顺序（播放器场景页签的固定次序） */
export const TOPOLOGY_FLOW_SCENE_IDS: TopologyFlowSceneId[] = ['read', 'write', 'failover'];

export function topologyFlowOf(
  dimId: string,
  optId: string | undefined,
  modeId: string
): TopologyFlow | null {
  if (!optId) return null;
  return topologyFlows.flows?.[dimId]?.[optId]?.[modeId] ?? null;
}

/** 这个形态有没有机理剧本（决定「▷ 看机理」按钮的显隐） */
export function hasTopologyFlow(
  dimId: string,
  optId: string | undefined,
  modeId: string
): boolean {
  return topologyFlowOf(dimId, optId, modeId) !== null;
}

/** 全库剧本规模（给空态文案与调试用，来自生成器注入的统计） */
export function topologyFlowStats(): { flowCount: number; sceneCount: number; stepCount: number } {
  return {
    flowCount: topologyFlows.flowCount ?? 0,
    sceneCount: topologyFlows.sceneCount ?? 0,
    stepCount: topologyFlows.stepCount ?? 0,
  };
}
