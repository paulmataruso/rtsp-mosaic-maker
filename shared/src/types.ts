import type { z } from 'zod';
import type {
  cameraCreateSchema,
  cameraUpdateSchema,
  cameraDtoSchema,
  mosaicInputSchema,
  mosaicUpdateSchema,
  mosaicDtoSchema,
  mosaicCellInputSchema,
  mosaicCellDtoSchema,
  systemSettingsSchema,
  systemSettingsUpdateSchema,
  cameraTestRequestSchema,
  cameraTestResultSchema,
  cameraTestStepResultSchema,
  onvifDiscoverRequestSchema,
  onvifDeviceSchema,
  onvifProfilesRequestSchema,
  onvifProfilesResultSchema,
  onvifProfileSchema,
  mosaicStatusSchema,
  mosaicMetricsSchema,
  mosaicTileStatusSchema,
  cameraStatusSchema,
  mediamtxStatusSchema,
  dashboardSummarySchema,
  resourceEstimateRequestSchema,
  resourceEstimateSchema,
  encoderCapabilitiesSchema,
  encoderCapabilitySchema,
  logEntrySchema,
  logQuerySchema,
  loginRequestSchema,
  loginResultSchema,
  errorResponseSchema,
} from './schemas.js';

export type CameraCreateInput = z.input<typeof cameraCreateSchema>;
export type CameraUpdateInput = z.input<typeof cameraUpdateSchema>;
export type CameraDto = z.infer<typeof cameraDtoSchema>;

export type MosaicInput = z.input<typeof mosaicInputSchema>;
export type MosaicUpdateInput = z.input<typeof mosaicUpdateSchema>;
export type MosaicDto = z.infer<typeof mosaicDtoSchema>;
export type MosaicCellInput = z.input<typeof mosaicCellInputSchema>;
export type MosaicCellDto = z.infer<typeof mosaicCellDtoSchema>;

export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type SystemSettingsUpdate = z.input<typeof systemSettingsUpdateSchema>;

export type CameraTestRequest = z.input<typeof cameraTestRequestSchema>;
export type CameraTestResult = z.infer<typeof cameraTestResultSchema>;
export type CameraTestStepResult = z.infer<typeof cameraTestStepResultSchema>;

export type OnvifDiscoverRequest = z.input<typeof onvifDiscoverRequestSchema>;
export type OnvifDevice = z.infer<typeof onvifDeviceSchema>;
export type OnvifProfilesRequest = z.input<typeof onvifProfilesRequestSchema>;
export type OnvifProfilesResult = z.infer<typeof onvifProfilesResultSchema>;
export type OnvifProfile = z.infer<typeof onvifProfileSchema>;

export type MosaicStatus = z.infer<typeof mosaicStatusSchema>;
export type MosaicMetrics = z.infer<typeof mosaicMetricsSchema>;
export type MosaicTileStatus = z.infer<typeof mosaicTileStatusSchema>;
export type CameraStatus = z.infer<typeof cameraStatusSchema>;
export type MediamtxStatus = z.infer<typeof mediamtxStatusSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export type ResourceEstimateRequest = z.input<typeof resourceEstimateRequestSchema>;
export type ResourceEstimate = z.infer<typeof resourceEstimateSchema>;

export type EncoderCapabilities = z.infer<typeof encoderCapabilitiesSchema>;
export type EncoderCapability = z.infer<typeof encoderCapabilitySchema>;

export type LogEntry = z.infer<typeof logEntrySchema>;
export type LogQuery = z.input<typeof logQuerySchema>;

export type LoginRequest = z.input<typeof loginRequestSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
