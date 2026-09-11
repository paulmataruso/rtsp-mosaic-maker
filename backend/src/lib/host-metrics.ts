import os from 'node:os';
import { readFile } from 'node:fs/promises';

/**
 * Best-effort host CPU / memory sampling. Reads /proc/stat when available
 * (Linux containers) for an aggregate CPU%; otherwise falls back to load
 * average vs core count. Memory uses cgroup v2 limits when present so the
 * number reflects the container, not the whole machine.
 */

interface CpuSample {
  idle: number;
  total: number;
}

let last: CpuSample | undefined;

async function readProcStat(): Promise<CpuSample | null> {
  try {
    const text = await readFile('/proc/stat', 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('cpu '));
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] =
      parts;
    const idleAll = idle + iowait;
    const nonIdle = user + nice + system + irq + softirq + steal;
    return { idle: idleAll, total: idleAll + nonIdle };
  } catch {
    return null;
  }
}

export async function sampleCpuPercent(): Promise<number | null> {
  const sample = await readProcStat();
  if (!sample) {
    const load = os.loadavg()[0] ?? 0;
    const cores = os.cpus().length || 1;
    return Math.min(100, Math.round((load / cores) * 100));
  }
  if (!last) {
    last = sample;
    return null;
  }
  const totalDelta = sample.total - last.total;
  const idleDelta = sample.idle - last.idle;
  last = sample;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
}

async function cgroupMemory(): Promise<{ used: number; total: number } | null> {
  try {
    const [usageRaw, maxRaw] = await Promise.all([
      readFile('/sys/fs/cgroup/memory.current', 'utf8').catch(() => ''),
      readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => ''),
    ]);
    const used = Number(usageRaw.trim());
    const max = maxRaw.trim();
    if (!Number.isFinite(used) || used <= 0) return null;
    const total = max === 'max' || max === '' ? os.totalmem() : Number(max);
    if (!Number.isFinite(total) || total <= 0) return null;
    return { used, total };
  } catch {
    return null;
  }
}

export async function memoryMb(): Promise<{ usedMb: number; totalMb: number }> {
  const cg = await cgroupMemory();
  if (cg) {
    return {
      usedMb: Math.round(cg.used / (1024 * 1024)),
      totalMb: Math.round(cg.total / (1024 * 1024)),
    };
  }
  const total = os.totalmem();
  const free = os.freemem();
  return {
    usedMb: Math.round((total - free) / (1024 * 1024)),
    totalMb: Math.round(total / (1024 * 1024)),
  };
}

export function loadAvg1(): number {
  return Math.round((os.loadavg()[0] ?? 0) * 100) / 100;
}

export function cpuCount(): number {
  return os.cpus().length || 1;
}
