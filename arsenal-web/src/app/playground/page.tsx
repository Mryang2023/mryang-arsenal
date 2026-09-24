import type { Metadata } from 'next';
import PlaygroundConsole from './PlaygroundConsole';

export const metadata: Metadata = {
  title: '案例实验室',
  description: '写一段 Java，点运行，后端用 JDK 21 子进程编译并执行，返回 stdout/stderr/退出码。',
};

export default function PlaygroundPage() {
  return <PlaygroundConsole />;
}
