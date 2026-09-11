import type { FitMode, StreamType, LabelPosition } from 'shared';

export interface CellState {
  cameraId: string | null;
  streamType: StreamType;
  fitMode: FitMode;
  label: string | null;
  labelEnabled: boolean;
  labelPosition: LabelPosition;
  labelFontSize: number;
  labelBgOpacity: number;
  enabled: boolean;
}

export function emptyCell(defaults: {
  streamType: StreamType;
  fitMode: FitMode;
}): CellState {
  return {
    cameraId: null,
    streamType: defaults.streamType,
    fitMode: defaults.fitMode,
    label: null,
    labelEnabled: true,
    labelPosition: 'bottom-left',
    labelFontSize: 20,
    labelBgOpacity: 0.45,
    enabled: true,
  };
}

export interface MosaicMeta {
  name: string;
  description: string;
  slug: string;
  slugCustom: boolean;
  rows: number;
  cols: number;
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  encoder: string;
  gopSeconds: number;
  backgroundColor: string;
  autoStart: boolean;
  enabled: boolean;
}
