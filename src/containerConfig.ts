import config from 'config';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { instanceCachingFactory } from 'tsyringe';
import jsLogger from '@map-colonies/js-logger';
import client from 'prom-client';
import { JobManagerClient } from '@map-colonies/mc-priority-queue';
import { commonNfsV1Type, commonS3FullV1Type } from '@map-colonies/schemas';
import { SERVICES, SERVICE_NAME } from './common/constants';
import { Provider } from './common/interfaces';
import { tracing } from './common/tracing';
import { ingestionRouterFactory, INGESTION_ROUTER_SYMBOL } from './ingestion/routes/ingestionRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { jobStatusRouterFactory, JOB_STATUS_ROUTER_SYMBOL } from './jobStatus/routes/jobStatusRouter';
import { QueueFileHandler } from './handlers/queueFileHandler';
import { getProvider } from './providers/getProvider';
import { getConfig } from './common/config';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = (options?: RegisterOptions): DependencyContainer => {
  const configInstance = getConfig();

  const jobManagerBaseUrl = configInstance.get('jobManager.url');
  const provider = configInstance.get('storage.provider');
  const loggerConfig = configInstance.get('telemetry.logger');
  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  tracing.start();
  const tracer = trace.getTracer(SERVICE_NAME);

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    {
      token: SERVICES.JOB_MANAGER_CLIENT,
      provider: {
        useFactory: (): JobManagerClient => {
          return new JobManagerClient(logger, jobManagerBaseUrl);
        },
      },
    },
    { token: INGESTION_ROUTER_SYMBOL, provider: { useFactory: ingestionRouterFactory } },
    { token: JOB_STATUS_ROUTER_SYMBOL, provider: { useFactory: jobStatusRouterFactory } },
    {
      token: SERVICES.METRICS_REGISTRY,
      provider: {
        useFactory: instanceCachingFactory(() => {
          if (config.get<boolean>('telemetry.metrics.enabled')) {
            client.register.setDefaultLabels({
              app: SERVICE_NAME,
            });
            return client.register;
          }
        }),
      },
    },
    {
      token: SERVICES.PROVIDER_CONFIG,
      provider: {
        useFactory: (): commonS3FullV1Type | commonNfsV1Type => {
          return configInstance.get('storage.config');
        },
      },
    },
    { token: SERVICES.QUEUE_FILE_HANDLER, provider: { useClass: QueueFileHandler } },
    {
      token: SERVICES.PROVIDER,
      provider: {
        useFactory: (): Provider => {
          return getProvider(provider);
        },
      },
    },
    {
      token: 'onSignal',
      provider: {
        useValue: {
          useValue: async (): Promise<void> => {
            await Promise.all([tracing.stop()]);
          },
        },
      },
    },
  ];

  return registerDependencies(dependencies, options?.override, options?.useChild);
};
