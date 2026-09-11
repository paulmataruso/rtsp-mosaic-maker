import { useDraggable } from '@dnd-kit/core';
import { Card, Group, Stack, Text, Badge, ScrollArea, TextInput } from '@mantine/core';
import { IconGripVertical, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import type { CameraDto } from 'shared';
import { useLiveStore } from '../../hooks/useLiveStatus';
import { HEALTH_COLOR } from '../../lib/format';

function PaletteItem({ camera }: { camera: CameraDto }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${camera.id}`,
    data: { type: 'palette', cameraId: camera.id },
  });
  const health = useLiveStore((s) => s.cameras[camera.id]?.health ?? 'unknown');
  return (
    <Card
      ref={setNodeRef}
      withBorder
      padding="xs"
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab' }}
      {...listeners}
      {...attributes}
    >
      <Group gap="xs" wrap="nowrap">
        <IconGripVertical size={14} opacity={0.5} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {camera.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {camera.host}
            {camera.subRtspUrl ? ' · sub ✓' : ''}
          </Text>
        </div>
        <Badge size="xs" color={HEALTH_COLOR[camera.enabled ? health : 'unknown']} variant="dot" />
      </Group>
    </Card>
  );
}

export function CameraPalette({ cameras }: { cameras: CameraDto[] }) {
  const [q, setQ] = useState('');
  const filtered = cameras.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card padding="sm" h="100%">
      <Stack gap="xs" h="100%">
        <Text fw={600} size="sm">
          Available cameras ({cameras.length})
        </Text>
        <TextInput
          size="xs"
          placeholder="Filter"
          leftSection={<IconSearch size={12} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <ScrollArea style={{ flex: 1 }} type="auto">
          <Stack gap={6}>
            {filtered.map((c) => (
              <PaletteItem key={c.id} camera={c} />
            ))}
            {filtered.length === 0 ? (
              <Text size="xs" c="dimmed">
                {cameras.length === 0 ? 'Add cameras first.' : 'No matches.'}
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
        <Text size="xs" c="dimmed">
          Drag a camera onto a cell. Drag between cells to swap.
        </Text>
      </Stack>
    </Card>
  );
}
