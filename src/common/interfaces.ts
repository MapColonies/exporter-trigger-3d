import { Layer3DMetadata } from '@map-colonies/mc-model-types';
import { ICreateJobBody, IJobResponse, OperationStatus } from '@map-colonies/mc-priority-queue';

export interface OpenApiConfig {
  filePath: string;
  basePath: string;
  jsonPath: string;
  uiPath: string;
}

export interface Payload {
  modelId: string;
  pathToTileset: string;
  tilesetFilename: string;
  metadata: Layer3DMetadata;
}

export interface Provider {
  streamModelPathsToQueueFile: (modelId: string, pathToTileset: string, productName: string) => Promise<number>;
}

export interface JobParameters {
  tilesetFilename: string;
  modelId: string;
  metadata: Layer3DMetadata;
  filesCount: number;
  pathToTileset: string;
}

export interface TaskParameters {
  paths: string[];
  modelId: string;
  lastIndexError: number;
}

export interface IngestionResponse {
  jobId: string;
  status: OperationStatus;
}

export interface JobStatusResponse {
  percentage: number;
  status: OperationStatus;
}

export interface JobStatusParams {
  jobId: string;
}

export interface LogContext {
  fileName: string;
  class: string;
  function?: string;
}

export type JobResponse = IJobResponse<JobParameters, TaskParameters>;
export type CreateJobBody = ICreateJobBody<JobParameters, TaskParameters>;
