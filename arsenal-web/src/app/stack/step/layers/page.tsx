import type { Metadata } from 'next';
import StepPage, { stepPageMeta } from '../step-page';

/** `/stack/step/layers` —— 装配台十步的 ④ layers；渲染与元信息见 ../step-page（一处定义，十条路由共用）。 */

export const metadata: Metadata = stepPageMeta('layers');

export default function Page() {
  return <StepPage id="layers" />;
}
