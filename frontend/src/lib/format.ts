import type { HealthLevel, MosaicState } from 'shared';

export function fmtBitrate(kbps: number | null | undefined): string {
  if (kbps == null) return '—';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps >= 10000 ? 0 : 1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function fmtFps(fps: number | null | undefined): string {
  return fps == null ? '—' : `${fps.toFixed(fps % 1 === 0 ? 0 : 1)} fps`;
}

export function fmtRes(w?: number | null, h?: number | null): string {
  return w && h ? `${w}×${h}` : '—';
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDuration(sinceIso: string | null | undefined): string {
  if (!sinceIso) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(sinceIso)) / 1000));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  const s = Math.round(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const HEALTH_COLOR: Record<HealthLevel, string> = {
  running: 'teal',
  warning: 'yellow',
  offline: 'red',
  unknown: 'gray',
};

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  running: 'Running',
  warning: 'Warning',
  offline: 'Offline',
  unknown: 'Unknown',
};

export const MOSAIC_STATE_COLOR: Record<MosaicState, string> = {
  created: 'gray',
  starting: 'blue',
  running: 'teal',
  degraded: 'yellow',
  stopped: 'gray',
  failed: 'red',
  restarting: 'orange',
};
