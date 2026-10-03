'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildDeployPlan, replicaLines } from '@/lib/deploy';
import DeliverRunStep from './steps/DeliverRunStep';
import DeployPreview from './DeployPreview';
import TopologyStep from './steps/TopologyStep';
import StackDeck from './StackDeck';
import JourneyBar from './JourneyBar';
import StepRail from './StepRail';
import TopologyPreview from './TopologyPreview';
import useStackChannel from './useStackChannel';
import { PAGE_OF_STEP, stepOfDim } from './wizard';

/**
 * ③ 运行与部署 —— `/stack/run`。
 *
 * 承载交付运行段的前两步（⑧ 交付与运行 ⑨ 部署形态）：「怎么跑、摆几个」。
 * 代码架构在选型台定完，这里专门定它的运行与交付面 ——
 * 运行环境 / 入口 / 编排 / 制品库 / CI/CD / 监控 / 密钥 / 日志，
 * 再逐个给已装上的零件定副本数。
 */
export default function StackRun() {
  const router = useRouter();
  const ch = useStackChannel('run');
  const { picks, meta, dimFlags, step, stepSummary, stepIssues, nameOk, pickTopology, setParam, activeDim } = ch;
  const { pick, clear, composed, projectName } = ch;

  /**
   * 形态图焦点：台上正在调哪一项（'app' 或维度 id）。
   * 默认 'app' —— 进来第一眼亮的是「应用跑几个」，那是这一步的主问题。
   *
   * ⚠️ 不叫 focusDim：本页已经有一个 `focusDim()`（点阵 / 差异 chip 直达用），
   * 同名会让后面那句 `onFocus={...}` 拿到函数而不是 state。
   */
  const [topoFocus, setTopoFocus] = useState<string>('app');

  /**
   * 部署产物（⑧ 右栏清单与形态图的副本数落点**同一份**）：真生成一遍，
   * 不从选型猜。猜出来的清单会和导出包对不上，那比没有更糟。
   */
  const deployFiles = useMemo(
    () =>
      buildDeployPlan(picks, composed, {
        appName: projectName || 'arsenal-demo',
        meta,
      }),
    [picks, composed, projectName, meta]
  );
  const replicaRows = useMemo(() => replicaLines(deployFiles), [deployFiles]);

  /** 点阵 / 差异 chip 直达：目标步骤不在本页就换页 */
  function focusDim(dimId: string) {
    const target = stepOfDim(dimId) ?? 'layers';
    ch.setStep(target);
    ch.setActiveDim(dimId);
    const home = PAGE_OF_STEP[target];
    if (home !== '/stack/run') router.push(home);
  }

  /** 本页两步的渲染内容 */
  function renderStep() {
    switch (step) {
      case 'deliverRun':
        return (
          <DeliverRunStep
            picks={picks}
            dimFlags={dimFlags}
            onPick={pick}
            onClear={clear}
            activeDim={activeDim}
          />
        );
      case 'topology':
        return (
          <TopologyStep
            picks={picks}
            meta={meta}
            dimFlags={dimFlags}
            onTopology={pickTopology}
            onParam={setParam}
            onPick={pick}
            onClear={clear}
            onFocus={setTopoFocus}
            activeDim={activeDim}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">架构装配台 · 运行与部署</h1>
      <StackDeck ch={ch} focusDim={focusDim} />
      <JourneyBar current="run" picks={picks} />
      <StepRail
        page="run"
        step={step}
        onStep={ch.setStep}
        summary={stepSummary}
        issues={stepIssues}
        canAdvance={nameOk}
        blockedHint={nameOk ? undefined : '先给项目起个名字（小写字母 + 点分段）—— 它要写进 pom 的 artifactId、application.yml 与 K8s 应用名。'}
      />
      {/* ⑨ 部署形态：左表单 + 右实时形态图。
          形态是在这一步定的，图原本只在交付中心的九块预览里 —— 调副本数要
          换页才看得到结果，等于盲调。两栏并排后「改一下 → 图跟着变」同屏发生。
          窄屏（< xl）退成上下堆叠：图在表单之后，不挤掉滑杆的操作空间。 */}
      {/* 右栏：⑨ 给形态图（调副本数同屏看结果），⑧ 给部署文件清单
          （在 ⑧ 表态，立刻看见自己表出了什么）。窄屏（< xl）退成上下堆叠。 */}
      {step === 'topology' ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">{renderStep()}</div>
          <div className="min-w-0 xl:sticky xl:top-3 xl:self-start">
            <TopologyPreview
              picks={picks}
              meta={meta}
              focusDim={topoFocus}
              onFocus={setTopoFocus}
              replicaLines={replicaRows}
            />
          </div>
        </div>
      ) : step === 'deliverRun' ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">{renderStep()}</div>
          <div className="min-w-0 xl:sticky xl:top-3 xl:self-start">
            <DeployPreview files={deployFiles} />
          </div>
        </div>
      ) : (
        renderStep()
      )}
    </div>
  );
}
