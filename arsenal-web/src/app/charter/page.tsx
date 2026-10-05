import type { Metadata } from 'next';
import CharterConsole from './CharterConsole';

export const metadata: Metadata = {
  title: '项目章程',
  description:
    '本项目在行业基线之上定下的规矩：条款、例外登记簿、债务账与命名一致性。改章程跟改代码一样走 PR。',
};

export default function CharterPage() {
  return <CharterConsole />;
}
