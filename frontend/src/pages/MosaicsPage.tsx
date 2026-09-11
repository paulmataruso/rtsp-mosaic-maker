import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Progress,
  Menu,
  ActionIcon,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import {
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconTrash,
  IconDotsVertical,
  IconEdit,
} from '@tabler/icons-react';
import { api } from '../api/client';
import { useLiveStore } from '../hooks/useLiveStatus';
import { Copyable } from '../components/Copyable';
import { fmtBitrate, fmtFps, fmtRes, MOSAIC_STATE_COLOR } from '../lib/format';

export function MosaicsPage() {
  const qc = useQueryClient();
  const { data: mosaics = [] } = useQuery({ queryKey: ['mosaics'], queryFn: api.listMosaics });
  const statuses = useLiveStore((s) => s.mosaics);

  const act = async (id: string, fn: () => Promise<unknown>, verb: string) => {
    try {
      await fn();
      notifications.show({ message: `Mosaic ${verb}.`, color: 'teal' });
    } catch (err) {
      notifications.show({ title: `Could not ${verb}`, message: (err as Error).message, color: 'red' });
    }
  };

  const del = (id: string, name: string) =>
    modals.openConfirmModal({
      title: `Delete mosaic "${name}"?`,
      children: (
        <Text size="sm">
          This stops FFmpeg, removes the MediaMTX path, and deletes the configuration. The RTSP URL
          will stop working.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        await act(id, () => api.deleteMosaic(id), 'deleted');
        qc.invalidateQueries({ queryKey: ['mosaics'] });
      },
    });

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Mosaic Streams</Title>
        <Button component={Link} to="/mosaics/new" leftSection={<IconPlus size={16} />}>
          New mosaic
        </Button>
      </Group>

      {mosaics.length === 0 ? (
        <Card>
          <Text c="dimmed">No mosaics configured yet.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
          {mosaics.map((m) => {
            const st = statuses[m.id];
            const state = st?.state ?? 'stopped';
            const running = ['running', 'degraded', 'starting', 'restarting'].includes(state);
            const placeholders = st?.tiles.filter((t) => t.render === 'placeholder').length ?? 0;
            return (
              <Card key={m.id} padding="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <div>
                      <Text fw={600}>{m.name}</Text>
                      <Text size="xs" c="dimmed">
                        /{m.slug} · {m.rows}×{m.cols} grid
                      </Text>
                    </div>
                    <Group gap={6}>
                      <Badge color={MOSAIC_STATE_COLOR[state]} variant="light" tt="capitalize">
                        {state}
                      </Badge>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray">
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            component={Link}
                            to={`/mosaics/${m.id}`}
                          >
                            Edit in designer
                          </Menu.Item>
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => del(m.id, m.name)}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Group>

                  <Text size="sm" c="dimmed">
                    {fmtRes(m.width, m.height)} · {fmtFps(m.fps)} · {fmtBitrate(m.videoBitrateKbps)} ·{' '}
                    {m.codec.toUpperCase()} · {m.encoder}
                  </Text>

                  {st && running ? (
                    <Group gap="lg">
                      <Text size="xs" c="dimmed">
                        out {fmtFps(st.metrics.fps)} · {fmtBitrate(st.metrics.bitrateKbps)}
                        {st.metrics.speed != null ? ` · ${st.metrics.speed.toFixed(2)}×` : ''}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {st.mediamtx.readers} reader(s)
                      </Text>
                      {st.metrics.cpuPercent != null ? (
                        <Text size="xs" c="dimmed">
                          {st.metrics.cpuPercent}% CPU · {st.metrics.memoryMb ?? '–'} MB
                        </Text>
                      ) : null}
                    </Group>
                  ) : null}

                  {placeholders > 0 ? (
                    <Text size="xs" c="yellow">
                      {placeholders} tile(s) showing OFFLINE placeholder
                    </Text>
                  ) : null}
                  {state === 'failed' && st?.lastError ? (
                    <Text size="xs" c="red">
                      {st.lastError}
                    </Text>
                  ) : null}
                  {state === 'restarting' && st?.backoffUntil ? (
                    <Text size="xs" c="orange">
                      Restarting (attempt {st.restartCount})…
                    </Text>
                  ) : null}

                  <Copyable value={m.rtspUrl} />

                  <Progress
                    value={running ? 100 : 0}
                    color={MOSAIC_STATE_COLOR[state]}
                    size="xs"
                    animated={state === 'starting' || state === 'restarting'}
                  />

                  <Group gap="xs">
                    {running ? (
                      <>
                        <Button
                          size="xs"
                          variant="light"
                          color="orange"
                          leftSection={<IconRefresh size={14} />}
                          onClick={() => act(m.id, () => api.restartMosaic(m.id), 'restarted')}
                        >
                          Restart
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          leftSection={<IconPlayerStop size={14} />}
                          onClick={() => act(m.id, () => api.stopMosaic(m.id), 'stopped')}
                        >
                          Stop
                        </Button>
                      </>
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
                    <Button size="xs" variant="default" component={Link} to={`/mosaics/${m.id}`}>
                      Edit
                    </Button>
                  </Group>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
