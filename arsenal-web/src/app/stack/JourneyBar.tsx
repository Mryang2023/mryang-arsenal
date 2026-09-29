'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { STACK_PAGES, type StackPageId } from './wizard';

/**
 * 装配旅程 —— 四页之间的横向导航。
 *
 * P0 拆四页之后，页内步骤条（StepRail）只看见**当前这一页的几步**，
 * 跨页去哪儿就没人说了。JourneyBar 补的正是这一层：四个节点常驻，
 * 当前页高亮，点一下直接换页。
 *
 * 节点与它承载的步骤**同一份出处**（wizard.STACK_PAGES），不在这里另排一张表。
 */
export default function JourneyBar({ current }: { current: StackPageId }) {
  return (
    <nav className="panel flex flex-wrap items-center gap-x-1 gap-y-1.5 px-3 py-2" aria-label="装配旅程">
      <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
        装配旅程
      </span>
      {STACK_PAGES.map((p, i) => {
        const on = p.id === current;
        return (
          <Fragment key={p.id}>
            {i > 0 && (
              <span aria-hidden className="mono mx-1 text-[11px] leading-none text-fgFaint">
                ›
              </span>
            )}
            <Link
              href={p.route}
              data-journey={p.id}
              aria-current={on ? 'page' : undefined}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                color: on ? '#D9A441' : '#93A39C',
              }}
              title={`${p.name} —— ${p.steps.length} 步：${p.steps.join(' · ')}`}
            >
              <span className="mono text-[12px] leading-none">{p.glyph}</span>
              <span className="mono text-[10px] leading-none text-fgFaint">{i + 1}</span>
              <span className="font-medium leading-[16px]">{p.name}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
