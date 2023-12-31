import config from 'config';
import { getOtelMixin, Metrics } from '@map-colonies/telemetry';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { JobManagerClient } from '@map-colonies/mc-priority-queue';
import { SERVICES, SERVICE_NAME } from './common/constants';
import { ProviderManager, ProvidersConfig } from './common/interfaces';
import { tracing } from './common/tracing';
import { jobsRouterFactory, JOBS_ROUTER_SYMBOL } from './jobs/routes/jobsRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { QueueFileHandler } from './handlers/queueFileHandler';
import { getProviderManager } from './providers/getProvider';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = (options?: RegisterOptions): DependencyContainer => {
  const jobManagerBaseUrl = config.get<string>('jobManager.url');
  const providerConfiguration = config.get<ProvidersConfig>('provider');
  const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  const metrics = new Metrics();
  metrics.start();

  tracing.start();
  const tracer = trace.getTracer(SERVICE_NAME);

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: config } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
    { token: SERVICES.METER, provider: { useValue: OtelMetrics.getMeterProvider().getMeter(SERVICE_NAME) } },
    {
      token: SERVICES.JOB_MANAGER_CLIENT,
      provider: {
        useFactory: (): JobManagerClient => {
          return new JobManagerClient(logger, jobManagerBaseUrl);
        },
      },
    },
    { token: JOBS_ROUTER_SYMBOL, provider: { useFactory: jobsRouterFactory } },
    { token: SERVICES.QUEUE_FILE_HANDLER, provider: { useClass: QueueFileHandler } },
    {
      token: SERVICES.PROVIDER_MANAGER,
      provider: {
        useFactory: (): ProviderManager => {
          return getProviderManager(providerConfiguration);
        },
      },
    },
    {
      token: 'onSignal',
      provider: {
        useValue: {
          useValue: async (): Promise<void> => {
            await Promise.all([tracing.stop(), metrics.stop()]);
          },
        },
      },
    },
  ];

  return registerDependencies(dependencies, options?.override, options?.useChild);
};
