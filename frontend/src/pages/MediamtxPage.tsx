import { Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconRefresh, IconExternalLink } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useLiveStore } from '../hooks/useLiveStatus';
import { api } from '../api/client';
import { StatCard } from '../components/StatCard';
import { StatusDot } from '../components/StatusDot';
import { fmtBytes, fmtDuration } from '../lib/format';

export function MediamtxPage() {
  const mtx = useLiveStore((s) => s.mediamtx);

  const reconcile = async () => {
    try {
      await api.mediamtxReconcile();
      notifications.show({ message: 'Reconciliation triggered.', color: 'teal' });
    } catch (err) {
      notifications.show({ title: 'Failed', message: (err as Error).message, color: 'red' });
    }
  };

  const totalReaders = mtx?.paths.reduce((a, p) => a + p.readers, 0) ?? 0;
  const publishers = mtx?.paths.filter((p) => p.ready).length ?? 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>MediaMTX</Title>
        <Group>
          <Button
            variant="default"
            component="a"
            href="/docs"
            target="_blank"
            leftSection={<IconExternalLink size={16} />}
          >
            API docs
          </Button>
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={reconcile}>
            Reconcile paths
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatCard
          label="Status"
          value={
            <Badge size="lg" color={mtx?.reachable ? 'teal' : 'red'} variant="light">
              {mtx?.reachable ? 'online' : 'offline'}
            </Badge>
          }
          sub={mtx?.version ? `v${mtx.version}` : mtx?.lastError ?? undefined}
        />
        <StatCard label="Uptime" value={fmtDuration(mtx ? new Date(Date.now() - (mtx.uptimeSeconds ?? 0) * 1000).toISOString() : null)} />
        <StatCard label="Active paths" value={mtx?.paths.length ?? '–'} sub={`${publishers} publishing`} />
        <StatCard label="Readers" value={totalReaders} />
      </SimpleGrid>

      <Card p={0}>
        <Table.ScrollContainer minWidth={760}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Path</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th>Tracks</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Readers</Table.Th>
                <Table.Th>In / Out</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(mtx?.paths ?? []).map((p) => (
                <Table.Tr key={p.name}>
                  <Table.Td>
                    <Text className="mono">/{p.name}</Text>
                    {p.managed ? (
                      <Badge size="xs" variant="light" color="brand">
                        managed
                      </Badge>
                    ) : (
                      <Badge size="xs" variant="light" color="gray">
                        external
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.source ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    {p.tracks.length ? (
                      p.tracks.map((t) => (
                        <Badge key={t} size="xs" variant="light" mr={4}>
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <StatusDot level={p.ready ? 'running' : 'offline'} label={p.ready ? 'ready' : 'idle'} />
                  </Table.Td>
                  <Table.Td>{p.readers}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {fmtBytes(p.bytesReceived)} / {fmtBytes(p.bytesSent)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {(mtx?.paths.length ?? 0) === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      {mtx?.reachable
                        ? 'No active paths. Start a mosaic to publish one.'
                        : 'MediaMTX is not reachable.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Text size="xs" c="dimmed">
        This app manages the paths tagged <b>managed</b> via the MediaMTX Control API ({mtx?.apiUrl}).
        Paths tagged <b>external</b> come from your mediamtx.yml and are never modified.
      </Text>
    </Stack>
  );
}
