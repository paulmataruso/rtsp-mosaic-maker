import { SimpleGrid, Group, Title, Text, Card, Badge, Button, Stack, Progress, Anchor } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  IconVideo,
  IconGridDots,
  IconCpu,
  IconServer2,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react';
import { api } from '../api/client';
import { useLiveStore } from '../hooks/useLiveStatus';
import { StatCard } from '../components/StatCard';
import { StatusDot } from '../components/StatusDot';
import { Copyable } from '../components/Copyable';
import { fmtBitrate, fmtFps, fmtRes, MOSAIC_STATE_COLOR } from '../lib/format';
import { notifications } from '@mantine/notifications';
import type { MosaicDto } from 'shared';

export function DashboardPage() {
  const { data: mosaics } = useQuery({ queryKey: ['mosaics'], queryFn: api.listMosaics });
  const dashboard = useLiveStore((s) => s.dashboard);
  const mosaicStatuses = useLiveStore((s) => s.mosaics);

  const act = async (id: string, fn: () => Promise<unknown>, verb: string) => {
    try {
      await fn();
      notifications.show({ message: `Mosaic ${verb}.`, color: 'teal' });
    } catch (err) {
      notifications.show({ title: `Could not ${verb}`, message: (err as Error).message, color: 'red' });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Dashboard</Title>
        <Button component={Link} to="/mosaics/new" leftSection={<IconGridDots size={16} />}>
          New mosaic
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        <StatCard
          label="Cameras online"
          value={`${dashboard?.camerasOnline ?? '–'} / ${dashboard?.camerasTotal ?? '–'}`}
          icon={<IconVideo size={20} />}
        />
        <StatCard
          label="Mosaics running"
          value={dashboard?.mosaicsRunning ?? '–'}
          sub={`${dashboard?.mosaicsTotal ?? 0} configured`}
          icon={<IconGridDots size={20} />}
        />
        <StatCard
          label="FFmpeg processes"
          value={dashboard?.ffmpegProcesses ?? '–'}
          sub={
            dashboard?.host.cpuPercent != null
              ? `Host CPU ~${dashboard.host.cpuPercent}% · ${dashboard.host.cpuCount} cores`
              : undefined
          }
          icon={<IconCpu size={20} />}
        />
        <StatCard
          label="MediaMTX"
          value={
            <Badge size="lg" color={dashboard?.mediamtx === 'online' ? 'teal' : 'red'} variant="light">
              {dashboard?.mediamtx ?? 'unknown'}
            </Badge>
          }
          sub={
            dashboard?.host.memUsedMb != null
              ? `RAM ${dashboard.host.memUsedMb} / ${dashboard.host.memTotalMb} MB`
              : undefined
          }
          icon={<IconServer2 size={20} />}
        />
      </SimpleGrid>

      <Title order={4}>Streams</Title>
      {(mosaics?.length ?? 0) === 0 ? (
        <Card>
          <Text c="dimmed">
            No mosaics yet.{' '}
            <Anchor component={Link} to="/mosaics/new">
              Create your first mosaic
            </Anchor>{' '}
            — add cameras, drop them into a grid, pick 1080p / 15 fps / H.264, and start.
          </Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {mosaics?.map((m: MosaicDto) => {
            const st = mosaicStatuses[m.id];
            const state = st?.state ?? 'stopped';
            const running = state === 'running' || state === 'degraded';
            return (
              <Card key={m.id} padding="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text fw={600}>{m.name}</Text>
                    <Badge color={MOSAIC_STATE_COLOR[state]} variant="light" tt="capitalize">
                      {state}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {fmtRes(m.width, m.height)} · {fmtFps(m.fps)} · {fmtBitrate(m.videoBitrateKbps)} ·{' '}
                    {m.codec.toUpperCase()}
                  </Text>
                  {running && st ? (
                    <Group gap="lg">
                      <Text size="xs" c="dimmed">
                        out {fmtFps(st.metrics.fps)} · {fmtBitrate(st.metrics.bitrateKbps)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {st.mediamtx.readers} reader{st.mediamtx.readers === 1 ? '' : 's'}
                      </Text>
                      {st.metrics.cpuPercent != null ? (
                        <Text size="xs" c="dimmed">
                          {st.metrics.cpuPercent}% CPU
                        </Text>
                      ) : null}
                    </Group>
                  ) : null}
                  {state === 'degraded' && st?.lastError ? (
                    <Text size="xs" c="yellow">
                      {st.lastError}
                    </Text>
                  ) : null}
                  <Copyable value={m.rtspUrl} />
                  <Progress
                    value={running ? 100 : 0}
                    color={MOSAIC_STATE_COLOR[state]}
                    size="xs"
                    animated={state === 'starting' || state === 'restarting'}
                  />
                  <Group gap="xs" mt={4}>
                    <Button
                      size="xs"
                      variant="light"
                      component={Link}
                      to={`/mosaics/${m.id}`}
                      leftSection={<IconSettings size={14} />}
                    >
                      Edit
                    </Button>
                    {running ? (
                      <Button
                        size="xs"
                        variant="light"
                        color="orange"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => act(m.id, () => api.restartMosaic(m.id), 'restarted')}
                      >
                        Restart
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="light"
                        color="teal"
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={() => act(m.id, () => api.startMosaic(m.id), 'started')}
                      >
                        Start
                      </Button>
                    )}
                    {running ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => act(m.id, () => api.stopMosaic(m.id), 'stopped')}
                      >
                        Stop
                      </Button>
                    ) : null}
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}

      <MediamtxMini />
    </Stack>
  );
}

function MediamtxMini() {
  const mtx = useLiveStore((s) => s.mediamtx);
  if (!mtx) return null;
  return (
    <Card>
      <Group justify="space-between">
        <Group gap="xs">
          <StatusDot level={mtx.reachable ? 'running' : 'offline'} label="MediaMTX" />
          {mtx.version ? (
            <Text size="sm" c="dimmed">
              v{mtx.version} · {mtx.paths.length} paths ·{' '}
              {mtx.paths.reduce((a, p) => a + p.readers, 0)} readers
            </Text>
          ) : (
            <Text size="sm" c="red">
              {mtx.lastError ?? 'unreachable'}
            </Text>
          )}
        </Group>
        <Anchor component={Link} to="/mediamtx" size="sm">
          Details →
        </Anchor>
      </Group>
    </Card>
  );
}
