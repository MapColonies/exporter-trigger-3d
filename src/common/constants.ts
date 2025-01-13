import { readPackageJsonSync } from '@map-colonies/read-pkg';

const packageJsonData = readPackageJsonSync();
export const SERVICE_NAME = packageJsonData.name ?? 'unknown_service';
export const SERVICE_VERSION = packageJsonData.version ?? 'unknown_version';
export const DEFAULT_SERVER_PORT = 80;

export const NODE_VERSION = process.versions.node;

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  PROVIDER: Symbol('Provider'),
  PROVIDER_CONFIG: Symbol('ProviderConfig'),
  QUEUE_FILE_HANDLER: Symbol('QueueFileHandler'),
  JOB_MANAGER_CLIENT: Symbol('JobManagerClient'),
};
/* eslint-enable @typescript-eslint/naming-convention */
