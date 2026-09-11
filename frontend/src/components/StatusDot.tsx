import type { HealthLevel } from 'shared';
import { HEALTH_LABEL } from '../lib/format';

export function StatusDot({ level, label }: { level: HealthLevel; label?: string }) {
  return (
    <span>
      <span className={`status-dot status-dot--${level}`} />
      {label ?? HEALTH_LABEL[level]}
    </span>
  );
}
