import { AppShell, Badge, Group, NavLink, ScrollArea, Text, Title, Tooltip } from '@mantine/core';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import {
  IconLayoutDashboard,
  IconVideo,
  IconGridDots,
  IconServer2,
  IconFileText,
  IconSettings,
  IconPlugConnected,
  IconPlugConnectedX,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useLiveConnection, useLiveStore } from '../hooks/useLiveStatus';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, end: true },
  { to: '/cameras', label: 'Cameras', icon: IconVideo },
  { to: '/mosaics', label: 'Mosaic Streams', icon: IconGridDots },
  { to: '/mediamtx', label: 'MediaMTX', icon: IconServer2 },
  { to: '/logs', label: 'Logs', icon: IconFileText },
  { to: '/settings', label: 'Settings', icon: IconSettings },
];

export function AppLayout({ children }: { children: ReactNode }) {
  useLiveConnection();
  const location = useLocation();
  const connected = useLiveStore((s) => s.connected);
  const mediamtx = useLiveStore((s) => s.mediamtx);
  const dashboard = useLiveStore((s) => s.dashboard);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm' }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconGridDots size={22} />
            <Title order={4} fw={700}>
              Camera Mosaic
            </Title>
          </Group>
          <Group gap="sm">
            {dashboard ? (
              <Text size="sm" c="dimmed" visibleFrom="sm">
                {dashboard.camerasOnline}/{dashboard.camerasTotal} cameras · {dashboard.mosaicsRunning}{' '}
                running · {dashboard.ffmpegProcesses} FFmpeg
              </Text>
            ) : null}
            <Tooltip label={`MediaMTX ${mediamtx?.reachable ? 'online' : 'offline'}`}>
              <Badge color={mediamtx?.reachable ? 'teal' : 'red'} variant="light">
                MediaMTX {mediamtx?.reachable ? 'online' : 'offline'}
              </Badge>
            </Tooltip>
            <Tooltip label={connected ? 'Live updates connected' : 'Reconnecting…'}>
              <Badge
                color={connected ? 'teal' : 'gray'}
                variant="light"
                leftSection={
                  connected ? <IconPlugConnected size={12} /> : <IconPlugConnectedX size={12} />
                }
              >
                {connected ? 'Live' : 'Offline'}
              </Badge>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {NAV.map((item) => {
            const active = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                label={item.label}
                leftSection={<item.icon size={18} />}
                active={active}
                variant="light"
              />
            );
          })}
        </AppShell.Section>
        <AppShell.Section>
          <Text size="xs" c="dimmed" ta="center" py="xs">
            v1.0.0 · <a href="/docs" target="_blank" rel="noreferrer">API docs</a>
          </Text>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
