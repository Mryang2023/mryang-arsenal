import type { Metadata } from 'next';
import StackDelivery from '../StackDelivery';

export const metadata: Metadata = {
  title: '交付中心',
  description:
    '装配台四页的最后一页：这套组合最后长什么样、怎么拿走。九块预览全部按当前选型实时算出来，可直接导出成能跑的工程 zip；导出前过一遍预检闸，包不自洽就当场拦下并列出问题。',
};

export default function StackDeliveryPage() {
  return <StackDelivery />;
}
