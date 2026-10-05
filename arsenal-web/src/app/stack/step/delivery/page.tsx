import type { Metadata } from 'next';
import StepPage, { stepPageMeta } from '../step-page';

/** `/stack/step/delivery` —— 装配台十步的 ⑩ delivery；渲染与元信息见 ../step-page（一处定义，十条路由共用）。 */

export const metadata: Metadata = stepPageMeta('delivery');

export default function Page() {
  return <StepPage id="delivery" />;
}
