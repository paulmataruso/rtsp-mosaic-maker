import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Table,
  Text,
  Title,
  TextInput,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { modals } from '@mantine/modals';
import {
  IconPlus,
  IconDotsVertical,
  IconTrash,
  IconEdit,
  IconPlugConnected,
  IconSearch,
  IconRadar2,
} from '@tabler/icons-react';
import { api } from '../api/client';
import { useLiveStore } from '../hooks/useLiveStatus';
import { StatusDot } from '../components/StatusDot';
import { fmtRelative, fmtRes, HEALTH_COLOR } from '../lib/format';
import { CameraFormModal } from './CameraFormModal';
import { OnvifDiscoverModal } from './OnvifDiscoverModal';
import type { CameraDto } from 'shared';

export function CamerasPage() {
  const qc = useQueryClient();
  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['cameras'],
    queryFn: api.listCameras,
  });
  const camStatuses = useLiveStore((s) => s.cameras);
  const [editing, setEditing] = useState<CameraDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const rows = useMemo(
    () =>
      cameras.filter(
        (c) =>
          c.name.toLowerCase().includes(filter.toLowerCase()) ||
          c.host.toLowerCase().includes(filter.toLowerCase()),
      ),
    [cameras, filter],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ['cameras'] });

  const remove = (cam: CameraDto) =>
    modals.openConfirmModal({
      title: `Delete camera "${cam.name}"?`,
      children: <Text size="sm">This cannot be undone. Mosaics referencing it will show an empty tile.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await api.deleteCamera(cam.id);
          notifications.show({ message: 'Camera deleted.', color: 'teal' });
          refresh();
        } catch (err) {
          notifications.show({ title: 'Delete failed', message: (err as Error).message, color: 'red' });
        }
      },
    });

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Cameras</Title>
        <Group>
          <Button
            variant="default"
            leftSection={<IconRadar2 size={16} />}
            onClick={() => setDiscoverOpen(true)}
          >
            Discover (ONVIF)
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add camera
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder="Filter by name or host"
        leftSection={<IconSearch size={14} />}
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
        maw={320}
      />

      <Card p={0}>
        <Table.ScrollContainer minWidth={720}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Host</Table.Th>
                <Table.Th>Streams</Table.Th>
                <Table.Th>Health</Table.Th>
                <Table.Th>Last check</Table.Th>
                <Table.Th style={{ width: 60 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((cam) => {
                const st = camStatuses[cam.id];
                const health = !cam.enabled ? 'unknown' : st?.health ?? 'unknown';
                return (
                  <Table.Tr key={cam.id}>
                    <Table.Td>
                      <Text fw={600}>{cam.name}</Text>
                      {cam.description ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {cam.description}
                        </Text>
                      ) : null}
                      {!cam.enabled ? (
                        <Badge size="xs" color="gray" variant="light">
                          disabled
                        </Badge>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Text className="mono">{cam.host}</Text>
                      <Text size="xs" c="dimmed">
                        {cam.transport.toUpperCase()}
                        {cam.username ? ` · ${cam.username}` : ''}
                        {cam.hasPassword ? ' · 🔒' : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light">main</Badge>{' '}
                      {cam.subRtspUrl ? <Badge variant="light">sub</Badge> : null}
                      {st?.width ? (
                        <Text size="xs" c="dimmed">
                          {fmtRes(st.width, st.height)} {st.codec ?? ''}
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={HEALTH_COLOR[health]} variant="light">
                        <StatusDot level={health} />
                      </Badge>
                      {st?.lastError ? (
                        <Text size="xs" c="red" lineClamp={1} maw={220}>
                          {st.lastError}
                        </Text>
                      ) : null}
                      {(st?.usedByRunningMosaics?.length ?? 0) > 0 ? (
                        <Text size="xs" c="dimmed">
                          in {st!.usedByRunningMosaics.length} running mosaic(s)
                        </Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {fmtRelative(st?.lastCheckedAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Menu withinPortal position="bottom-end">
                        <Menu.Target>
                          <Button variant="subtle" size="xs" px={6}>
                            <IconDotsVertical size={16} />
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => {
                              setEditing(cam);
                              setFormOpen(true);
                            }}
                          >
                            Edit
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconPlugConnected size={14} />}
                            onClick={() => {
                              setEditing(cam);
                              setFormOpen(true);
                            }}
                          >
                            Test connection
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => remove(cam)}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {rows.length === 0 && !isLoading ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      No cameras. Add one manually or run ONVIF discovery.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <CameraFormModal
        opened={formOpen}
        camera={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          refresh();
        }}
      />
      <OnvifDiscoverModal
        opened={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        onPick={(prefill) => {
          setDiscoverOpen(false);
          setEditing(prefill as CameraDto);
          setFormOpen(true);
        }}
      />
    </Stack>
  );
}
