import config from 'config';
import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 80;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

export const JOB_TYPE = config.get<string>('fileSyncer.job.type');

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
  PROVIDER: Symbol('Provider'),
  PROVIDER_CONFIG: Symbol('ProviderConfig'),
  QUEUE_FILE_HANDLER: Symbol('QueueFileHandler'),
  JOB_MANAGER_CLIENT: Symbol('JobManagerClient'),
};
/* eslint-enable @typescript-eslint/naming-convention */
