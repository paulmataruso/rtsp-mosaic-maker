import { useState } from 'react';
import {
  Modal,
  Stack,
  Button,
  Group,
  Text,
  Table,
  Loader,
  Alert,
  TextInput,
  PasswordInput,
  Badge,
  Divider,
} from '@mantine/core';
import { IconRadar2, IconDownload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { api } from '../api/client';
import type { OnvifDevice, OnvifProfile } from 'shared';

export function OnvifDiscoverModal({
  opened,
  onClose,
  onPick,
}: {
  opened: boolean;
  onClose: () => void;
  onPick: (prefill: Record<string, unknown>) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<OnvifDevice[] | null>(null);
  const [selected, setSelected] = useState<OnvifDevice | null>(null);
  const [creds, setCreds] = useState({ username: '', password: '' });
  const [profiles, setProfiles] = useState<OnvifProfile[] | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(false);

  const scan = async () => {
    setScanning(true);
    setDevices(null);
    setSelected(null);
    setProfiles(null);
    try {
      const { devices } = await api.onvifDiscover(5000);
      setDevices(devices);
    } catch (err) {
      notifications.show({ title: 'Discovery failed', message: (err as Error).message, color: 'red' });
    } finally {
      setScanning(false);
    }
  };

  const loadProfiles = async (dev: OnvifDevice) => {
    setSelected(dev);
    setProfiles(null);
    setLoadingProfiles(true);
    try {
      const res = await api.onvifProfiles({
        host: dev.address,
        port: dev.port || 80,
        username: creds.username,
        password: creds.password,
      });
      setProfiles(res.profiles);
    } catch (err) {
      notifications.show({ title: 'Could not fetch profiles', message: (err as Error).message, color: 'red' });
    } finally {
      setLoadingProfiles(false);
    }
  };

  const applyProfile = (main: OnvifProfile, sub?: OnvifProfile) => {
    if (!selected) return;
    onPick({
      _prefill: {
        name: selected.name ?? selected.address,
        host: selected.address,
        mainRtspUrl: main.rtspUri ?? '',
        subRtspUrl: sub?.rtspUri ?? '',
        username: creds.username,
        password: creds.password,
      },
    });
  };

  return (
    <Modal opened={opened} onClose={onClose} title="ONVIF discovery" size="xl">
      <Stack>
        <Alert color="blue" variant="light">
          WS-Discovery uses UDP multicast and only works when the container runs with{' '}
          <b>network_mode: host</b> (Linux). Manual entry always works — use “Add camera”.
        </Alert>
        <Group>
          <Button leftSection={<IconRadar2 size={16} />} loading={scanning} onClick={scan}>
            Scan the LAN
          </Button>
          {devices ? <Text c="dimmed">{devices.length} device(s) responded</Text> : null}
        </Group>

        {scanning ? <Loader /> : null}

        {devices && devices.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Device</Table.Th>
                <Table.Th>Address</Table.Th>
                <Table.Th>Service</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {devices.map((d) => (
                <Table.Tr key={d.xaddrs[0] ?? d.address}>
                  <Table.Td>
                    <Text fw={600}>{d.name ?? 'Unknown'}</Text>
                    <Text size="xs" c="dimmed">
                      {d.hardware ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text className="mono">
                      {d.address}:{d.port}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1} maw={260}>
                      {d.xaddrs[0]}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button size="xs" variant="light" onClick={() => loadProfiles(d)}>
                      Select
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : null}

        {devices && devices.length === 0 ? (
          <Text c="dimmed">
            No devices answered. Check host networking, or add the camera manually.
          </Text>
        ) : null}

        {selected ? (
          <>
            <Divider label={`Credentials for ${selected.name ?? selected.address}`} />
            <Group grow>
              <TextInput
                label="Username"
                value={creds.username}
                onChange={(e) => setCreds((c) => ({ ...c, username: e.currentTarget.value }))}
              />
              <PasswordInput
                label="Password"
                value={creds.password}
                onChange={(e) => setCreds((c) => ({ ...c, password: e.currentTarget.value }))}
              />
              <Button mt="lg" loading={loadingProfiles} onClick={() => loadProfiles(selected)}>
                Fetch profiles
              </Button>
            </Group>
          </>
        ) : null}

        {profiles ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Profile</Table.Th>
                <Table.Th>Encoding</Table.Th>
                <Table.Th>Resolution</Table.Th>
                <Table.Th>RTSP URI</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {profiles.map((p, i) => (
                <Table.Tr key={p.token}>
                  <Table.Td>{p.name}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{p.encoding ?? '?'}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {p.resolution ? `${p.resolution.width}×${p.resolution.height}` : '—'}
                  </Table.Td>
                  <Table.Td>
                    <Text className="mono" lineClamp={1} maw={280}>
                      {p.rtspUri ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconDownload size={14} />}
                      disabled={!p.rtspUri}
                      onClick={() => applyProfile(p, profiles[i + 1] ?? undefined)}
                    >
                      Use as main
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : null}
      </Stack>
    </Modal>
  );
}
