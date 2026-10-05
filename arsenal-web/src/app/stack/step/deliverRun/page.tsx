import type { Metadata } from 'next';
import StepPage, { stepPageMeta } from '../step-page';

/** `/stack/step/deliverRun` —— 装配台十步的 ⑧ deliverRun；渲染与元信息见 ../step-page（一处定义，十条路由共用）。 */

export const metadata: Metadata = stepPageMeta('deliverRun');

export default function Page() {
  return <StepPage id="deliverRun" />;
}
