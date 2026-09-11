import type { Metadata } from 'next';
import CheckConsole from './CheckConsole';

export const metadata: Metadata = {
  title: '校验台',
  description: '粘贴代码，按军火库规则逐条比对，输出带行号的违规清单与合规分。',
};

export default function CheckPage() {
  return <CheckConsole />;
}
