'use client';

import { useRouter } from 'next/navigation';
import { clearScaffoldDraft } from '@/lib/picks-store';
import FrontendStep from './steps/FrontendStep';
import EnvStep from './steps/EnvStep';
import ModulesStep from './steps/ModulesStep';
import StackDeck from './StackDeck';
import JourneyBar from './JourneyBar';
import StepRail from './StepRail';
import useStackChannel from './useStackChannel';
import { PAGE_OF_STEP, stepOfDim } from './wizard';

/**
 * ② 环境与模块 —— `/stack/env`。
 *
 * 承载前端与环境段的③步（⑤ 前端技术栈 ⑥ 环境与连接 ⑦ 功能模块）：
 * 「我连什么、带什么」。这一步之前代码架构已经在选型台定完，
 * 这里只回答它跑在哪个环境上、带哪些现成模块。
 */
export default function StackEnv() {
  const router = useRouter();
  const ch = useStackChannel('env');
  const {
    picks, activeDim, audit, dotFlags, issueDots, step, stepSummary, stepIssues, nameOk,
    feBase, setFeBase, feUi, setFeUi, scaffoldForms, setScaffoldEnv, setScaffoldSecrets, allEnvValues,
    demoMode, setDemoMode, rememberSecrets, setRememberSecrets, envMissing,
    moduleResolution, moduleIds, setModuleIds, hist, snapRef,
  } = ch;

  /** 点阵 / 差异 chip 直达：目标步骤不在本页就换页（跨页导航不丢） */
  function focusDim(dimId: string) {
    const target = stepOfDim(dimId) ?? 'layers';
    ch.setStep(target);
    ch.setActiveDim(dimId);
    const home = PAGE_OF_STEP[target];
    if (home !== '/stack/env') router.push(home);
  }

  /** 本页三步的渲染内容 */
  function renderStep() {
    switch (step) {
      case 'frontend':
        return (
          <FrontendStep
            feBase={feBase}
            feUi={feUi}
            onFeBase={(id) => {
              if (id === 'none' && moduleIds.length > 0) {
                // 切到无前端时模块保留勾选（后端接口照出），⑦ 的警告条会说明后果 ——
                // 这里绝不静默清掉用户的选择
              }
              setFeBase(id);
            }}
            onFeUi={setFeUi}
          />
        );
      case 'env':
        return (
          <EnvStep
            forms={scaffoldForms}
            values={allEnvValues}
            demoMode={demoMode}
            rememberSecrets={rememberSecrets}
            missing={envMissing}
            onChange={(key, value) => {
              const secret = scaffoldForms
                .flatMap((f) => f.fields)
                .find((x) => x.key === key)?.secret;
              hist.record(snapRef.current);
              if (secret) setScaffoldSecrets((m) => ({ ...m, [key]: value }));
              else setScaffoldEnv((m) => ({ ...m, [key]: value }));
              // 改了密码且未勾记住 → 旧落盘密码立即失效（避免「以为改了其实没存」）
              if (secret && !rememberSecrets) clearScaffoldDraft();
            }}
            onDemoMode={(on) => {
              hist.record(snapRef.current);
              setDemoMode(on);
            }}
            onRememberSecrets={(on) => {
              hist.record(snapRef.current);
              setRememberSecrets(on);
              if (!on) setScaffoldSecrets({});
            }}
            onUseDefaults={() => {
              // 回落占位符默认：只清**非密码**的必填字段（密码类走既有落盘规则，
              // 不在这里另立一套）。键取自表单事实源，不写死字段个数。
              hist.record(snapRef.current);
              const keys = scaffoldForms
                .flatMap((f) => f.fields)
                .filter((f) => f.required && !f.secret)
                .map((f) => f.key);
              setScaffoldEnv((m) => {
                const next = { ...m };
                for (const k of keys) delete next[k];
                return next;
              });
            }}
          />
        );
      case 'modules':
        return (
          <ModulesStep
            selectedIds={moduleResolution.selected.map((m) => m.id)}
            warnings={moduleResolution.warnings}
            onToggle={(id) => {
              hist.record(snapRef.current);
              setModuleIds((ids) => {
                const has = ids.includes(id);
                const next = has ? ids.filter((x) => x !== id) : [...ids, id];
                // 依赖闭包在 resolveModules 里补；这里只补「取消时」的直观性 —— 不静默加选项
                return next;
              });
            }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">架构装配台 · 环境与模块</h1>
      <StackDeck ch={ch} focusDim={focusDim} />
      <JourneyBar current="env" picks={picks} />
      <StepRail
        page="env"
        step={step}
        onStep={ch.setStep}
        summary={stepSummary}
        issues={stepIssues}
        canAdvance={nameOk}
        blockedHint={nameOk ? undefined : '先给项目起个名字（小写字母 + 点分段）—— 它要写进 pom 的 artifactId、application.yml 与 K8s 应用名。'}
      />
      {renderStep()}
    </div>
  );
}
