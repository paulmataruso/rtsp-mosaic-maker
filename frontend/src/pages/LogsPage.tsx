import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Title,
  Select,
} from '@mantine/core';
import { IconTrash, IconArrowDown } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useLiveStore, subscribeChannel } from '../hooks/useLiveStatus';
import type { LogEntry, LogSource } from 'shared';

const SOURCES: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'app', label: 'Application' },
  { value: 'ffmpeg', label: 'FFmpeg' },
  { value: 'mediamtx', label: 'MediaMTX' },
  { value: 'camera', label: 'Camera' },
];

export function LogsPage() {
  const [source, setSource] = useState<string>('all');
  const [level, setLevel] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const liveLogs = useLiveStore((s) => s.logs);
  const clearLive = useLiveStore((s) => s.clearLogs);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    subscribeChannel('logs');
  }, []);

  const history = useQuery({
    queryKey: ['logs', source, level],
    queryFn: () =>
      api.logs({
        source: source === 'all' ? undefined : (source as LogSource),
        level: (level as LogEntry['level']) || undefined,
        limit: 500,
      }),
    refetchOnMount: 'always',
  });

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(history.data?.entries ?? []), ...liveLogs];
    const out: LogEntry[] = [];
    for (const e of all) {
      const key = `${e.ts}|${e.source}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (source !== 'all' && e.source !== source) continue;
      if (level && e.level !== level) continue;
      out.push(e);
    }
    return out.slice(-1500);
  }, [history.data, liveLogs, source, level]);

  useEffect(() => {
    if (follow && viewport.current) {
      viewport.current.scrollTo({ top: viewport.current.scrollHeight });
    }
  }, [merged, follow]);

  return (
    <Stack gap="md" h="calc(100vh - 120px)">
      <Group justify="space-between">
        <Title order={2}>Logs</Title>
        <Group>
          <Switch label="Follow" checked={follow} onChange={(e) => setFollow(e.currentTarget.checked)} />
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconTrash size={14} />}
            onClick={clearLive}
          >
            Clear view
          </Button>
        </Group>
      </Group>

      <Group>
        <SegmentedControl data={SOURCES} value={source} onChange={setSource} size="xs" />
        <Select
          size="xs"
          placeholder="Any level"
          clearable
          data={['trace', 'debug', 'info', 'warn', 'error', 'fatal']}
          value={level}
          onChange={setLevel}
          w={130}
        />
        <Badge variant="light">{merged.length} lines</Badge>
      </Group>

      <Card p="xs" style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%" viewportRef={viewport} type="auto">
          {merged.map((e, i) => (
            <div key={i} className={`log-line log-line--${e.level}`}>
              <Text span c="dimmed">
                {new Date(e.ts).toLocaleTimeString()}{' '}
              </Text>
              <Text span c="dimmed">
                [{e.source}]
              </Text>{' '}
              {e.message}
            </div>
          ))}
          {merged.length === 0 ? (
            <Text c="dimmed" size="sm">
              No log entries match the filter.
            </Text>
          ) : null}
        </ScrollArea>
      </Card>

      {!follow ? (
        <Button
          variant="light"
          leftSection={<IconArrowDown size={14} />}
          onClick={() => {
            setFollow(true);
            viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
          }}
          style={{ position: 'sticky', bottom: 8, alignSelf: 'center' }}
        >
          Jump to latest
        </Button>
      ) : null}
    </Stack>
  );
}
