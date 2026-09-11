import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Badge,
  Code,
  Table,
} from '@mantine/core';
import { IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from '../api/client';
import type { SystemSettings } from 'shared';

export function SettingsPage() {
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const capsQ = useQuery({ queryKey: ['capabilities'], queryFn: () => api.capabilities() });
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsQ.data && !draft) setDraft(settingsQ.data);
  }, [settingsQ.data, draft]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(draft);
      setDraft(updated);
      notifications.show({ message: 'Settings saved.', color: 'teal' });
    } catch (err) {
      notifications.show({ title: 'Save failed', message: (err as Error).message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const rescan = async () => {
    try {
      await api.capabilities(true);
      capsQ.refetch();
      notifications.show({ message: 'Encoder scan complete.', color: 'teal' });
    } catch (err) {
      notifications.show({ title: 'Scan failed', message: (err as Error).message, color: 'red' });
    }
  };

  if (!draft) return null;

  const num = (key: keyof SystemSettings) => ({
    value: draft[key] as number,
    onChange: (v: string | number) =>
      setDraft((d) => (d ? { ...d, [key]: Number(v) || 0 } : d)),
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Settings</Title>

      <Card padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Hardware acceleration</Text>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={rescan}
          >
            Re-scan encoders
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mb="xs">
          FFmpeg {capsQ.data?.ffmpegVersion ?? '…'} · devices:{' '}
          {capsQ.data?.devices.dri.join(', ') || 'none'}{' '}
          {capsQ.data?.devices.nvidia ? '· NVIDIA present' : ''}
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Encoder</Table.Th>
              <Table.Th>Available</Table.Th>
              <Table.Th>Detail</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(capsQ.data?.encoders ?? []).map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>
                  <Code>{e.id}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge color={e.available ? 'teal' : 'gray'} variant="light">
                    {e.available ? 'yes' : 'no'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {e.detail}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card padding="md">
        <Text fw={600} mb="sm">
          Defaults for new mosaics &amp; cameras
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Default encoder"
            data={(capsQ.data?.encoders ?? []).map((e) => ({
              value: e.id,
              label: e.id,
              disabled: !e.available,
            }))}
            value={draft.defaultEncoder}
            onChange={(v) => v && setDraft((d) => (d ? { ...d, defaultEncoder: v as never } : d))}
          />
          <Select
            label="Default RTSP transport"
            data={['tcp', 'udp', 'auto']}
            value={draft.defaultTransport}
            onChange={(v) => v && setDraft((d) => (d ? { ...d, defaultTransport: v as never } : d))}
          />
          <Select
            label="Default stream for mosaic tiles"
            data={[
              { value: 'sub', label: 'Substream (recommended)' },
              { value: 'main', label: 'Main' },
            ]}
            value={draft.defaultStreamType}
            onChange={(v) => v && setDraft((d) => (d ? { ...d, defaultStreamType: v as never } : d))}
          />
          <Select
            label="Default fit mode"
            data={['letterbox', 'fit', 'fill', 'crop']}
            value={draft.defaultFitMode}
            onChange={(v) => v && setDraft((d) => (d ? { ...d, defaultFitMode: v as never } : d))}
          />
        </SimpleGrid>
      </Card>

      <Card padding="md">
        <Text fw={600} mb="sm">
          Network resilience
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          <NumberInput
            label="RTSP connect timeout (ms)"
            min={1000}
            max={60000}
            step={500}
            {...num('rtspConnectTimeoutMs')}
          />
          <NumberInput
            label="RTSP read timeout (ms)"
            description="No-frame watchdog"
            min={2000}
            max={120000}
            step={1000}
            {...num('rtspReadTimeoutMs')}
          />
          <NumberInput
            label="Restart backoff base (ms)"
            min={500}
            max={60000}
            step={500}
            {...num('reconnectBaseDelayMs')}
          />
          <NumberInput
            label="Restart backoff max (ms)"
            min={1000}
            max={600000}
            step={1000}
            {...num('reconnectMaxDelayMs')}
          />
          <NumberInput
            label="Max restart attempts"
            description="Then the mosaic is marked failed"
            min={1}
            max={1000}
            {...num('maxRestartAttempts')}
          />
        </SimpleGrid>
      </Card>

      <Group>
        <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={save}>
          Save settings
        </Button>
      </Group>
    </Stack>
  );
}
