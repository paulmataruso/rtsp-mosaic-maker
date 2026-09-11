import {
  Card,
  Stack,
  TextInput,
  Select,
  NumberInput,
  Switch,
  Group,
  Text,
  Badge,
  Tooltip,
  ColorInput,
} from '@mantine/core';
import type { MosaicMeta } from './types';
import type { EncoderCapabilities, ResourceEstimate } from 'shared';

interface Presets {
  layouts: { id: string; label: string; rows: number; cols: number; fixed: boolean }[];
  resolutions: { id: string; label: string; width: number; height: number }[];
  fps: number[];
  bitratesKbps: number[];
  encoders: { id: string; label: string; family: string; codec: string; note: string }[];
}

const BAND_COLOR: Record<ResourceEstimate['band'], string> = {
  low: 'teal',
  moderate: 'blue',
  high: 'yellow',
  'very-high': 'red',
};

export function OutputSettings({
  meta,
  onChange,
  presets,
  capabilities,
  estimate,
  slugState,
}: {
  meta: MosaicMeta;
  onChange: (patch: Partial<MosaicMeta>) => void;
  presets: Presets | undefined;
  capabilities: EncoderCapabilities | undefined;
  estimate: ResourceEstimate | undefined;
  slugState: { valid: boolean; reason: string | null };
}) {
  const layoutId = `${meta.rows}x${meta.cols}`;
  const resId =
    presets?.resolutions.find((r) => r.width === meta.width && r.height === meta.height)?.id ??
    'custom';

  const encoderData = (presets?.encoders ?? []).map((e) => {
    const cap = capabilities?.encoders.find((c) => c.id === e.id);
    const unavailable = e.id !== 'libx264' && cap && !cap.available;
    return {
      value: e.id,
      label: unavailable ? `${e.label} — unavailable` : e.label,
      disabled: !!unavailable,
    };
  });
  const encoderNote =
    presets?.encoders.find((e) => e.id === meta.encoder)?.note ??
    'Software encoder. Always available.';

  return (
    <Card padding="sm">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          Output
        </Text>

        <TextInput
          label="Name"
          withAsterisk
          value={meta.name}
          onChange={(e) => onChange({ name: e.currentTarget.value })}
        />
        <TextInput
          label="Stream name (MediaMTX path / slug)"
          description={
            slugState.valid ? `rtsp://<host>:8554/${meta.slug}` : slugState.reason ?? 'Invalid slug'
          }
          error={!slugState.valid}
          value={meta.slug}
          onChange={(e) => onChange({ slug: e.currentTarget.value, slugCustom: true })}
          rightSection={
            meta.slugCustom ? (
              <Tooltip label="Reset to auto from name">
                <Badge
                  size="xs"
                  variant="light"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onChange({ slugCustom: false })}
                >
                  auto
                </Badge>
              </Tooltip>
            ) : null
          }
        />

        <Select
          label="Layout"
          data={(presets?.layouts ?? []).map((l) => ({ value: l.id, label: l.label }))}
          value={presets?.layouts.some((l) => l.id === layoutId) ? layoutId : null}
          placeholder={`${meta.rows} × ${meta.cols} (custom)`}
          onChange={(v) => {
            const l = presets?.layouts.find((x) => x.id === v);
            if (l) onChange({ rows: l.rows, cols: l.cols });
          }}
        />

        <Group grow>
          <Select
            label="Resolution"
            data={[
              ...(presets?.resolutions ?? []).map((r) => ({ value: r.id, label: r.label })),
              { value: 'custom', label: 'Custom' },
            ]}
            value={resId}
            onChange={(v) => {
              const r = presets?.resolutions.find((x) => x.id === v);
              if (r) onChange({ width: r.width, height: r.height });
            }}
          />
          <Select
            label="FPS"
            data={(presets?.fps ?? [5, 10, 15, 20, 25, 30]).map((f) => ({
              value: String(f),
              label: `${f} fps`,
            }))}
            value={String(meta.fps)}
            onChange={(v) => v && onChange({ fps: Number(v) })}
          />
        </Group>

        {resId === 'custom' ? (
          <Group grow>
            <NumberInput
              label="Width"
              min={160}
              max={7680}
              step={2}
              value={meta.width}
              onChange={(v) => onChange({ width: Number(v) || meta.width })}
            />
            <NumberInput
              label="Height"
              min={160}
              max={4320}
              step={2}
              value={meta.height}
              onChange={(v) => onChange({ height: Number(v) || meta.height })}
            />
          </Group>
        ) : null}

        <Group grow>
          <Select
            label="Bitrate"
            data={[
              ...(presets?.bitratesKbps ?? []).map((b) => ({
                value: String(b),
                label: b >= 1000 ? `${b / 1000} Mbps` : `${b} kbps`,
              })),
              { value: 'custom', label: 'Custom' },
            ]}
            value={
              presets?.bitratesKbps.includes(meta.videoBitrateKbps)
                ? String(meta.videoBitrateKbps)
                : 'custom'
            }
            onChange={(v) => v && v !== 'custom' && onChange({ videoBitrateKbps: Number(v) })}
          />
          <NumberInput
            label="Bitrate (kbps)"
            min={200}
            max={100000}
            step={500}
            value={meta.videoBitrateKbps}
            onChange={(v) => onChange({ videoBitrateKbps: Number(v) || meta.videoBitrateKbps })}
          />
        </Group>

        <Select
          label="Encoder"
          description={encoderNote}
          data={encoderData}
          value={meta.encoder}
          onChange={(v) => v && onChange({ encoder: v })}
        />

        <Group grow>
          <ColorInput
            label="Background"
            format="hex"
            value={meta.backgroundColor.startsWith('#') ? meta.backgroundColor : '#000000'}
            onChange={(v) => onChange({ backgroundColor: v })}
            swatches={['#000000', '#111318', '#1a1a1a', '#0b1221']}
          />
          <NumberInput
            label="Keyframe interval (s)"
            min={0.5}
            max={10}
            step={0.5}
            value={meta.gopSeconds}
            onChange={(v) => onChange({ gopSeconds: Number(v) || 2 })}
          />
        </Group>

        <Switch
          label="Start automatically when the app starts"
          checked={meta.autoStart}
          onChange={(e) => onChange({ autoStart: e.currentTarget.checked })}
        />

        {estimate ? (
          <Card withBorder padding="xs" bg="var(--mantine-color-dark-6)">
            <Group justify="space-between">
              <Text size="xs" fw={600}>
                Estimated load
              </Text>
              <Badge color={BAND_COLOR[estimate.band]} variant="light" tt="capitalize">
                {estimate.band.replace('-', ' ')}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              ~{estimate.estimatedCpuCores} CPU cores · ~{estimate.estimatedMemoryMb} MB RAM
            </Text>
            {estimate.notes.slice(0, 2).map((n, i) => (
              <Text key={i} size="xs" c="dimmed" mt={2}>
                • {n}
              </Text>
            ))}
          </Card>
        ) : null}
      </Stack>
    </Card>
  );
}
