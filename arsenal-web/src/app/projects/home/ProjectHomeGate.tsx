'use client';

import { useSearchParams } from 'next/navigation';
import ProjectHome from './ProjectHome';

/** 读 ?id= 的客户端门（useSearchParams 只能活在 client 组件里，且必须挂在 Suspense 内）。 */
export default function ProjectHomeGate() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  return <ProjectHome projectId={id} />;
}
