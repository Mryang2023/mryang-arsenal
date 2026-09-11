import { SEVERITY_THEME } from '@/lib/theme';
import type { Severity } from '@/lib/types';

interface Props {
  severity: Severity;
  size?: 'sm' | 'md';
  showCode?: boolean;
}

export default function SeverityBadge({ severity, size = 'md', showCode = false }: Props) {
  const t = SEVERITY_THEME[severity];
  const sm = size === 'sm';
  return (
    <span
      className="mono inline-flex shrink-0 items-center rounded border font-medium uppercase"
      style={{
        color: t.color,
        borderColor: t.color + '55',
        background: t.soft,
        fontSize: sm ? 10 : 11,
        lineHeight: sm ? '15px' : '17px',
        padding: sm ? '0 5px' : '1px 7px',
        letterSpacing: '0.07em',
      }}
      title={t.meaning}
    >
      {t.label}
      {showCode && <span className="ml-1 opacity-60">{severity}</span>}
    </span>
  );
}
