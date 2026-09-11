import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ActionIcon, Badge, Text } from '@mantine/core';
import { IconX, IconVideoOff } from '@tabler/icons-react';
import type { CameraDto } from 'shared';
import type { CellState } from './types';
import { useLiveStore } from '../../hooks/useLiveStatus';

interface GridProps {
  rows: number;
  cols: number;
  cells: Record<number, CellState>;
  cameras: Record<string, CameraDto>;
  selected: number | null;
  onSelect: (pos: number) => void;
  onClear: (pos: number) => void;
  runtimeRender?: Record<number, 'live' | 'placeholder' | 'empty'>;
}

function Cell({
  pos,
  cell,
  camera,
  selected,
  onSelect,
  onClear,
  runtime,
}: {
  pos: number;
  cell: CellState | undefined;
  camera: CameraDto | undefined;
  selected: boolean;
  onSelect: () => void;
  onClear: () => void;
  runtime?: 'live' | 'placeholder' | 'empty';
}) {
  const filled = !!cell?.cameraId;
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: `cell:${pos}`, data: { type: 'cell', pos } });
  const {
    attributes,
    listeners,
    setNodeRef: dragRef,
    isDragging,
  } = useDraggable({
    id: `cell-drag:${pos}`,
    data: { type: 'cell', pos },
    disabled: !filled,
  });

  const health = useLiveStore((s) => (camera ? s.cameras[camera.id]?.health : undefined));

  return (
    <div
      ref={dropRef}
      className={
        'mosaic-cell' +
        (filled ? ' mosaic-cell--filled' : '') +
        (selected ? ' mosaic-cell--selected' : '') +
        (isOver ? ' mosaic-cell--over' : '')
      }
      style={{ opacity: isDragging ? 0.4 : 1 }}
      onClick={onSelect}
    >
      <div
        ref={dragRef}
        {...(filled ? listeners : {})}
        {...attributes}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          cursor: filled ? 'grab' : 'pointer',
          padding: 6,
        }}
      >
        {filled ? (
          <>
            <Text size="sm" fw={600} ta="center" lineClamp={2}>
              {camera?.name ?? 'Unknown camera'}
            </Text>
            <Badge size="xs" variant="light" color={cell?.streamType === 'sub' ? 'blue' : 'grape'}>
              {cell?.streamType === 'sub' ? 'substream' : 'main'} · {cell?.fitMode}
            </Badge>
            {runtime === 'placeholder' ? (
              <Badge size="xs" color="red" variant="light" leftSection={<IconVideoOff size={10} />}>
                offline
              </Badge>
            ) : health && health !== 'running' ? (
              <Badge size="xs" color="yellow" variant="light">
                {health}
              </Badge>
            ) : null}
          </>
        ) : (
          <Text size="xs" c="dimmed">
            cell {pos + 1}
          </Text>
        )}
      </div>
      {filled ? (
        <ActionIcon
          size="xs"
          variant="filled"
          color="red"
          style={{ position: 'absolute', top: 4, right: 4 }}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <IconX size={12} />
        </ActionIcon>
      ) : null}
    </div>
  );
}

export function MosaicGrid({
  rows,
  cols,
  cells,
  cameras,
  selected,
  onSelect,
  onClear,
  runtimeRender,
}: GridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 8,
        width: '100%',
      }}
    >
      {Array.from({ length: rows * cols }, (_, pos) => {
        const cell = cells[pos];
        const camera = cell?.cameraId ? cameras[cell.cameraId] : undefined;
        return (
          <Cell
            key={pos}
            pos={pos}
            cell={cell}
            camera={camera}
            selected={selected === pos}
            onSelect={() => onSelect(pos)}
            onClear={() => onClear(pos)}
            runtime={runtimeRender?.[pos]}
          />
        );
      })}
    </div>
  );
}
