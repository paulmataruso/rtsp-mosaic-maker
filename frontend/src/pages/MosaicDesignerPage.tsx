import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Grid,
  Group,
  Stack,
  Title,
  Button,
  Card,
  Text,
  Loader,
  Center,
  Breadcrumbs,
  Anchor,
  ScrollArea,
} from '@mantine/core';
import { IconDeviceFloppy, IconPlayerPlay, IconArrowLeft } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { api } from '../api/client';
import { useLiveStore } from '../hooks/useLiveStatus';
import { CameraPalette } from './mosaic-designer/CameraPalette';
import { MosaicGrid } from './mosaic-designer/MosaicGrid';
import { CellInspector } from './mosaic-designer/CellInspector';
import { OutputSettings } from './mosaic-designer/OutputSettings';
import { emptyCell, type CellState, type MosaicMeta } from './mosaic-designer/types';
import type { MosaicInput, EncoderId } from 'shared';

const DEFAULT_META: MosaicMeta = {
  name: 'New Mosaic',
  description: '',
  slug: 'new-mosaic',
  slugCustom: false,
  rows: 2,
  cols: 2,
  width: 1920,
  height: 1080,
  fps: 15,
  videoBitrateKbps: 4000,
  encoder: 'libx264',
  gopSeconds: 2,
  backgroundColor: '#000000',
  autoStart: false,
  enabled: true,
};

export function MosaicDesignerPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const camerasQ = useQuery({ queryKey: ['cameras'], queryFn: api.listCameras });
  const presetsQ = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const capsQ = useQuery({ queryKey: ['capabilities'], queryFn: () => api.capabilities() });
  const mosaicQ = useQuery({
    queryKey: ['mosaic', id],
    queryFn: () => api.getMosaic(id!),
    enabled: editing,
  });

  const [meta, setMeta] = useState<MosaicMeta>(DEFAULT_META);
  const [cells, setCells] = useState<Record<number, CellState>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [dragCameraId, setDragCameraId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);

  // Hydrate from an existing mosaic.
  useEffect(() => {
    if (!editing || !mosaicQ.data || loadedRef.current) return;
    loadedRef.current = true;
    const m = mosaicQ.data;
    setMeta({
      name: m.name,
      description: m.description,
      slug: m.slug,
      slugCustom: true,
      rows: m.rows,
      cols: m.cols,
      width: m.width,
      height: m.height,
      fps: m.fps,
      videoBitrateKbps: m.videoBitrateKbps,
      encoder: m.encoder,
      gopSeconds: m.gopSeconds,
      backgroundColor: m.backgroundColor.startsWith('#') ? m.backgroundColor : '#000000',
      autoStart: m.autoStart,
      enabled: m.enabled,
    });
    const next: Record<number, CellState> = {};
    for (const c of m.cells) {
      next[c.position] = {
        cameraId: c.cameraId,
        streamType: c.streamType,
        fitMode: c.fitMode,
        label: c.label,
        labelEnabled: c.labelEnabled,
        labelPosition: c.labelPosition,
        labelFontSize: c.labelFontSize,
        labelBgOpacity: c.labelBgOpacity,
        enabled: c.enabled,
      };
    }
    setCells(next);
  }, [editing, mosaicQ.data]);

  // Auto-slug from name unless customised.
  useEffect(() => {
    if (meta.slugCustom || !meta.name) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .slugPreview(meta.name)
        .then((r) => !cancelled && setMeta((prev) => (prev.slugCustom ? prev : { ...prev, slug: r.slug })))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [meta.name, meta.slugCustom]);

  const slugCheck = useSlugValidity(meta.slug);

  // Resource estimate (debounced).
  const [estimate, setEstimate] = useState<Awaited<ReturnType<typeof api.estimate>> | undefined>();
  const estimateKey = useMemo(
    () =>
      JSON.stringify({
        w: meta.width,
        h: meta.height,
        fps: meta.fps,
        enc: meta.encoder,
        tiles: Object.values(cells)
          .filter((c) => c.cameraId && c.enabled)
          .map((c) => c.streamType),
      }),
    [meta.width, meta.height, meta.fps, meta.encoder, cells],
  );
  useEffect(() => {
    const tiles = Object.values(cells)
      .filter((c) => c.cameraId && c.enabled)
      .map((c) => ({ streamType: c.streamType }));
    if (tiles.length === 0) {
      setEstimate(undefined);
      return;
    }
    const t = setTimeout(() => {
      api
        .estimate({
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          encoder: meta.encoder as EncoderId,
          tiles,
          excludeMosaicId: id,
        })
        .then(setEstimate)
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const capacity = meta.rows * meta.cols;
  const cameraMap = useMemo(
    () => Object.fromEntries((camerasQ.data ?? []).map((c) => [c.id, c])),
    [camerasQ.data],
  );
  const runtimeRender = useLiveStore((s) => (id ? s.mosaics[id]?.tiles : undefined));
  const runtimeMap = useMemo(() => {
    const map: Record<number, 'live' | 'placeholder' | 'empty'> = {};
    for (const t of runtimeRender ?? []) map[t.position] = t.render;
    return map;
  }, [runtimeRender]);

  const setCell = (pos: number, patch: Partial<CellState>) =>
    setCells((prev) => ({
      ...prev,
      [pos]: { ...(prev[pos] ?? emptyCell({ streamType: 'sub', fitMode: 'letterbox' })), ...patch },
    }));

  const clearCell = (pos: number) =>
    setCells((prev) => {
      const next = { ...prev };
      delete next[pos];
      return next;
    });

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { type?: string; cameraId?: string; pos?: number } | undefined;
    if (data?.type === 'palette') setDragCameraId(data.cameraId ?? null);
    if (data?.type === 'cell' && data.pos != null) setDragCameraId(cells[data.pos]?.cameraId ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragCameraId(null);
    const over = e.over;
    if (!over) return;
    const overData = over.data.current as { type?: string; pos?: number } | undefined;
    const activeData = e.active.data.current as
      | { type?: string; cameraId?: string; pos?: number }
      | undefined;
    if (overData?.type !== 'cell' || overData.pos == null) return;
    const target = overData.pos;

    if (activeData?.type === 'palette' && activeData.cameraId) {
      setCell(target, {
        cameraId: activeData.cameraId,
        streamType: 'sub',
        fitMode: 'letterbox',
      });
      setSelected(target);
    } else if (activeData?.type === 'cell' && activeData.pos != null && activeData.pos !== target) {
      // Swap
      setCells((prev) => {
        const next = { ...prev };
        const a = next[activeData.pos!];
        const b = next[target];
        if (a) next[target] = a;
        else delete next[target];
        if (b) next[activeData.pos!] = b;
        else delete next[activeData.pos!];
        return next;
      });
      setSelected(target);
    }
  };

  const build = (): MosaicInput => ({
    name: meta.name.trim(),
    description: meta.description,
    slug: meta.slug,
    rows: meta.rows,
    cols: meta.cols,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    videoBitrateKbps: meta.videoBitrateKbps,
    codec: 'h264',
    encoder: meta.encoder as MosaicInput['encoder'],
    gopSeconds: meta.gopSeconds,
    backgroundColor: meta.backgroundColor,
    autoStart: meta.autoStart,
    enabled: meta.enabled,
    cells: Object.entries(cells)
      .filter(([pos]) => Number(pos) < capacity)
      .map(([pos, c]) => ({
        position: Number(pos),
        cameraId: c.cameraId,
        streamType: c.streamType,
        fitMode: c.fitMode,
        label: c.label,
        labelEnabled: c.labelEnabled,
        labelPosition: c.labelPosition,
        labelFontSize: c.labelFontSize,
        labelBgOpacity: c.labelBgOpacity,
        enabled: c.enabled,
      })),
  });

  const save = async (thenStart: boolean) => {
    setSaving(true);
    try {
      const payload = build();
      const result = editing
        ? await api.updateMosaic(id!, payload)
        : await api.createMosaic(payload);
      qc.invalidateQueries({ queryKey: ['mosaics'] });
      notifications.show({ message: `Mosaic ${editing ? 'saved' : 'created'}.`, color: 'teal' });
      if (thenStart) {
        await api.startMosaic(result.id);
        notifications.show({ message: 'Mosaic started.', color: 'teal' });
      }
      navigate(`/mosaics/${result.id}`, { replace: true });
      if (!editing) loadedRef.current = false;
    } catch (err) {
      notifications.show({ title: 'Save failed', message: (err as Error).message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  if ((editing && mosaicQ.isLoading) || presetsQ.isLoading) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  const filledCount = Object.values(cells).filter((c) => c.cameraId).length;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Breadcrumbs>
              <Anchor onClick={() => navigate('/mosaics')} size="sm">
                Mosaic Streams
              </Anchor>
              <Text size="sm">{editing ? meta.name : 'New mosaic'}</Text>
            </Breadcrumbs>
            <Title order={2} mt={4}>
              Mosaic Designer
            </Title>
          </div>
          <Group>
            <Button
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              onClick={() => navigate('/mosaics')}
            >
              Back
            </Button>
            <Button
              variant="light"
              leftSection={<IconDeviceFloppy size={16} />}
              loading={saving}
              disabled={!slugCheck.valid || !meta.name.trim()}
              onClick={() => save(false)}
            >
              Save
            </Button>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              loading={saving}
              disabled={!slugCheck.valid || !meta.name.trim() || filledCount === 0}
              onClick={() => save(true)}
            >
              Save &amp; Start
            </Button>
          </Group>
        </Group>

        <Grid gutter="md">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <CameraPalette cameras={camerasQ.data ?? []} />
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card padding="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600} size="sm">
                    {meta.rows} × {meta.cols} grid · {filledCount}/{capacity} cells filled
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meta.width}×{meta.height} @ {meta.fps} fps
                  </Text>
                </Group>
                <MosaicGrid
                  rows={meta.rows}
                  cols={meta.cols}
                  cells={cells}
                  cameras={cameraMap}
                  selected={selected}
                  onSelect={setSelected}
                  onClear={clearCell}
                  runtimeRender={runtimeMap}
                />
                <Text size="xs" c="dimmed">
                  Cells beyond the grid are ignored. Empty cells render as the background colour.
                </Text>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <ScrollArea.Autosize mah="calc(100vh - 160px)" type="auto">
              <Stack gap="md">
                <CellInspector
                  pos={selected}
                  cell={selected !== null ? cells[selected] : undefined}
                  cameras={camerasQ.data ?? []}
                  onChange={(patch) => selected !== null && setCell(selected, patch)}
                  onClear={() => selected !== null && clearCell(selected)}
                />
                <OutputSettings
                  meta={meta}
                  onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}
                  presets={presetsQ.data}
                  capabilities={capsQ.data}
                  estimate={estimate}
                  slugState={slugCheck}
                />
              </Stack>
            </ScrollArea.Autosize>
          </Grid.Col>
        </Grid>
      </Stack>

      <DragOverlay>
        {dragCameraId ? (
          <Card withBorder padding="xs" style={{ width: 180 }}>
            <Text size="sm" fw={600} truncate>
              {cameraMap[dragCameraId]?.name ?? 'Camera'}
            </Text>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function useSlugValidity(slug: string): { valid: boolean; reason: string | null } {
  const [state, setState] = useState<{ valid: boolean; reason: string | null }>({
    valid: true,
    reason: null,
  });
  useEffect(() => {
    if (!slug) {
      setState({ valid: false, reason: 'Slug is required' });
      return;
    }
    const ok = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
    setState({
      valid: ok,
      reason: ok ? null : 'Lowercase letters, digits and single hyphens only',
    });
  }, [slug]);
  return state;
}
