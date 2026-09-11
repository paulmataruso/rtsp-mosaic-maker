import {
  Card,
  Stack,
  Select,
  SegmentedControl,
  Switch,
  TextInput,
  Slider,
  Text,
  Group,
  Button,
  Divider,
} from '@mantine/core';
import type { CameraDto, FitMode, LabelPosition, StreamType } from 'shared';
import type { CellState } from './types';

const FIT_OPTIONS = [
  { value: 'letterbox', label: 'Letterbox' },
  { value: 'fit', label: 'Fit' },
  { value: 'fill', label: 'Fill' },
  { value: 'crop', label: 'Crop' },
];

const LABEL_POS: { value: LabelPosition; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export function CellInspector({
  pos,
  cell,
  cameras,
  onChange,
  onClear,
}: {
  pos: number | null;
  cell: CellState | undefined;
  cameras: CameraDto[];
  onChange: (patch: Partial<CellState>) => void;
  onClear: () => void;
}) {
  if (pos === null || !cell) {
    return (
      <Card padding="sm">
        <Text size="sm" c="dimmed">
          Select a cell to configure the camera, stream, fit and label.
        </Text>
      </Card>
    );
  }

  const camera = cell.cameraId ? cameras.find((c) => c.id === cell.cameraId) : undefined;
  const canSub = !!camera?.subRtspUrl;

  return (
    <Card padding="sm">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Cell {pos + 1}
          </Text>
          {cell.cameraId ? (
            <Button size="compact-xs" variant="subtle" color="red" onClick={onClear}>
              Remove camera
            </Button>
          ) : null}
        </Group>

        <Select
          label="Camera"
          placeholder="Empty cell"
          clearable
          data={cameras.map((c) => ({ value: c.id, label: c.name }))}
          value={cell.cameraId}
          onChange={(v) => onChange({ cameraId: v })}
        />

        {cell.cameraId ? (
          <>
            <div>
              <Text size="xs" fw={500} mb={4}>
                Stream
              </Text>
              <SegmentedControl
                fullWidth
                size="xs"
                data={[
                  { value: 'sub', label: canSub ? 'Substream (recommended)' : 'Substream (n/a)' },
                  { value: 'main', label: 'Main' },
                ]}
                value={cell.streamType}
                onChange={(v) => onChange({ streamType: v as StreamType })}
              />
              {!canSub && cell.streamType === 'sub' ? (
                <Text size="xs" c="yellow" mt={2}>
                  This camera has no substream URL — it will fall back to the main stream.
                </Text>
              ) : null}
            </div>

            <Select
              label="Fit mode"
              data={FIT_OPTIONS}
              value={cell.fitMode}
              onChange={(v) => onChange({ fitMode: (v ?? 'letterbox') as FitMode })}
            />

            <Divider label="Label" />
            <Switch
              label="Show label on this tile"
              checked={cell.labelEnabled}
              onChange={(e) => onChange({ labelEnabled: e.currentTarget.checked })}
            />
            {cell.labelEnabled ? (
              <>
                <TextInput
                  label="Label text"
                  placeholder={camera?.name}
                  value={cell.label ?? ''}
                  onChange={(e) => onChange({ label: e.currentTarget.value || null })}
                />
                <Select
                  label="Position"
                  data={LABEL_POS}
                  value={cell.labelPosition}
                  onChange={(v) => onChange({ labelPosition: (v ?? 'bottom-left') as LabelPosition })}
                />
                <div>
                  <Text size="xs">Font size: {cell.labelFontSize}px</Text>
                  <Slider
                    min={8}
                    max={64}
                    value={cell.labelFontSize}
                    onChange={(v) => onChange({ labelFontSize: v })}
                  />
                </div>
                <div>
                  <Text size="xs">Background opacity: {Math.round(cell.labelBgOpacity * 100)}%</Text>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={cell.labelBgOpacity}
                    onChange={(v) => onChange({ labelBgOpacity: v })}
                  />
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </Stack>
    </Card>
  );
}
