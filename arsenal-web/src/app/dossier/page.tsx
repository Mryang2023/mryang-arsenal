import type { Metadata } from 'next';
import DossierConsole from './DossierConsole';

export const metadata: Metadata = {
  title: '项目档案',
  description:
    '当前项目自己记了什么：开发章程全文、数据库变更历史、表结构说明、DDL 脚本与表→实体映射。只读索引项目缓存里的文档，不执行任何 SQL。',
};

export default function DossierPage() {
  return <DossierConsole />;
}
