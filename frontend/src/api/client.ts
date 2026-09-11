import type {
  CameraDto,
  CameraCreateInput,
  CameraUpdateInput,
  CameraTestRequest,
  CameraTestResult,
  CameraStatus,
  MosaicDto,
  MosaicInput,
  MosaicUpdateInput,
  MosaicStatus,
  MediamtxStatus,
  DashboardSummary,
  SystemSettings,
  SystemSettingsUpdate,
  EncoderCapabilities,
  ResourceEstimateRequest,
  ResourceEstimate,
  LogEntry,
  LogQuery,
  OnvifDevice,
  OnvifProfilesResult,
} from 'shared';

const TOKEN_KEY = 'cmp.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    if (res.status === 401) setToken(null);
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return data as T;
}

export const api = {
  // auth
  authStatus: () => request<{ authEnabled: boolean }>('GET', '/auth/status'),
  login: (username: string, password: string) =>
    request<{ token: string; expiresIn: number }>('POST', '/auth/login', { username, password }),

  // dashboard / system
  dashboard: () => request<DashboardSummary>('GET', '/system/dashboard'),
  settings: () => request<SystemSettings>('GET', '/system/settings'),
  updateSettings: (patch: SystemSettingsUpdate) =>
    request<SystemSettings>('PUT', '/system/settings', patch),
  capabilities: (refresh = false) =>
    request<EncoderCapabilities>('GET', `/system/capabilities${refresh ? '?refresh=true' : ''}`),
  presets: () =>
    request<{
      layouts: { id: string; label: string; rows: number; cols: number; fixed: boolean }[];
      resolutions: { id: string; label: string; width: number; height: number }[];
      fps: number[];
      bitratesKbps: number[];
      encoders: { id: string; label: string; family: string; codec: string; note: string }[];
      fitModes: string[];
    }>('GET', '/system/presets'),
  estimate: (req: ResourceEstimateRequest) =>
    request<ResourceEstimate>('POST', '/system/estimate', req),

  // cameras
  listCameras: () => request<CameraDto[]>('GET', '/cameras'),
  getCamera: (id: string) => request<CameraDto>('GET', `/cameras/${id}`),
  createCamera: (input: CameraCreateInput) => request<CameraDto>('POST', '/cameras', input),
  updateCamera: (id: string, input: CameraUpdateInput) =>
    request<CameraDto>('PUT', `/cameras/${id}`, input),
  deleteCamera: (id: string) => request<{ ok: true }>('DELETE', `/cameras/${id}`),
  testCamera: (id: string, req: CameraTestRequest) =>
    request<CameraTestResult>('POST', `/cameras/${id}/test`, req),
  cameraStatuses: () => request<CameraStatus[]>('GET', '/cameras-status'),

  // mosaics
  listMosaics: () => request<MosaicDto[]>('GET', '/mosaics'),
  getMosaic: (id: string) => request<MosaicDto>('GET', `/mosaics/${id}`),
  createMosaic: (input: MosaicInput) => request<MosaicDto>('POST', '/mosaics', input),
  updateMosaic: (id: string, input: MosaicUpdateInput) =>
    request<MosaicDto>('PUT', `/mosaics/${id}`, input),
  deleteMosaic: (id: string) => request<{ ok: true }>('DELETE', `/mosaics/${id}`),
  startMosaic: (id: string) => request<MosaicStatus>('POST', `/mosaics/${id}/start`),
  stopMosaic: (id: string) => request<MosaicStatus>('POST', `/mosaics/${id}/stop`),
  restartMosaic: (id: string) => request<MosaicStatus>('POST', `/mosaics/${id}/restart`),
  mosaicStatuses: () => request<MosaicStatus[]>('GET', '/mosaics-status'),
  slugPreview: (name: string) =>
    request<{ slug: string; valid: boolean; reason: string | null }>(
      'GET',
      `/mosaics/slug-preview?name=${encodeURIComponent(name)}`,
    ),

  // mediamtx
  mediamtxStatus: () => request<MediamtxStatus>('GET', '/mediamtx/status'),
  mediamtxReconcile: () => request<{ ok: true }>('POST', '/mediamtx/reconcile'),

  // onvif
  onvifDiscover: (timeoutMs = 5000) =>
    request<{ devices: OnvifDevice[] }>('POST', '/onvif/discover', { timeoutMs }),
  onvifProfiles: (args: { host: string; port: number; username: string; password: string }) =>
    request<OnvifProfilesResult>('POST', '/onvif/profiles', args),

  // logs
  logs: (q: Partial<LogQuery> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
    const qs = params.toString();
    return request<{ entries: LogEntry[] }>('GET', `/logs${qs ? `?${qs}` : ''}`);
  },
};
