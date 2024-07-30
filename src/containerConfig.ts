import config from 'config';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { instanceCachingFactory } from 'tsyringe';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import client from 'prom-client';
import { JobManagerClient } from '@map-colonies/mc-priority-queue';
import { FlowProducer, Queue } from 'bullmq';
import { SERVICES, SERVICE_NAME } from './common/constants';
import { Provider, ProviderConfig } from './common/interfaces';
import { tracing } from './common/tracing';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { QueueFileHandler } from './handlers/queueFileHandler';
import { getProvider, getProviderConfig } from './providers/getProvider';
import { IConfig } from './common/interfaces';
import { IngestionManager } from './ingestion/ingestionManager';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = (options?: RegisterOptions): DependencyContainer => {
  const jobManagerBaseUrl = config.get<string>('jobManager.url');
  const provider = config.get<string>('ingestion.provider');
  const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  tracing.start();
  const tracer = trace.getTracer(SERVICE_NAME);

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: config } },
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
    {
      token: SERVICES.METRICS_REGISTRY,
      provider: {
        useFactory: instanceCachingFactory((container) => {
          const config = container.resolve<IConfig>(SERVICES.CONFIG);

          if (config.get<boolean>('telemetry.metrics.enabled')) {
            client.register.setDefaultLabels({
              app: SERVICE_NAME,
            });
            return client.register;
          }
        }),
      },
    },
    { token: SERVICES.INGESTION_MANAGER, provider: { useClass: IngestionManager } },
    {
      token: SERVICES.PROVIDER_CONFIG,
      provider: {
        useFactory: (): ProviderConfig => {
          return getProviderConfig(provider);
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
      token: SERVICES.FLOW_PRODUCER,
      provider: {
        useFactory: (): FlowProducer => {
          return new FlowProducer({
            connection: {
              host: '127.0.0.1',
              port: 6379,
            },
            prefix: '3D',
          });
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
