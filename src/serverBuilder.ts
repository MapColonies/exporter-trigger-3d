import express, { Router } from 'express';
import bodyParser from 'body-parser';
import compression from 'compression';
import { OpenapiViewerRouter } from '@map-colonies/openapi-express-viewer';
import { getErrorHandlerMiddleware } from '@map-colonies/error-express-handler';
import { middleware as OpenApiMiddleware } from 'express-openapi-validator';
import { inject, injectable } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import httpLogger from '@map-colonies/express-access-log-middleware';
import { collectMetricsExpressMiddleware } from '@map-colonies/telemetry';
import { Registry } from 'prom-client';
import { SERVICES } from './common/constants';
import { INGESTION_ROUTER_SYMBOL } from './ingestion/routes/ingestionRouter';
import { JOB_STATUS_ROUTER_SYMBOL } from './jobStatus/routes/jobStatusRouter';
import { handleError } from './common/handleError';
import { ConfigType } from './common/config';

@injectable()
export class ServerBuilder {
  private readonly serverInstance: express.Application;

  public constructor(
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(INGESTION_ROUTER_SYMBOL) private readonly ingestionRouter: Router,
    @inject(JOB_STATUS_ROUTER_SYMBOL) private readonly jobStatusRouter: Router,
    @inject(SERVICES.METRICS_REGISTRY) private readonly metricsRegistry?: Registry
  ) {
    this.serverInstance = express();
  }

  public build(): express.Application {
    this.registerPreRoutesMiddleware();
    this.buildRoutes();
    this.registerPostRoutesMiddleware();

    return this.serverInstance;
  }

  private buildDocsRoutes(): void {
    const openapiRouter = new OpenapiViewerRouter({
      ...this.config.get('openapiConfig'),
      filePathOrSpec: this.config.get('openapiConfig.filePath'),
    });
    openapiRouter.setup();
    this.serverInstance.use(this.config.get('openapiConfig.basePath'), openapiRouter.getRouter());
  }

  private buildRoutes(): void {
    this.serverInstance.use('/ingestion', this.ingestionRouter);
    this.serverInstance.use('/jobStatus', this.jobStatusRouter);
    this.buildDocsRoutes();
  }

  private registerPreRoutesMiddleware(): void {
    if (this.metricsRegistry) {
      this.serverInstance.use(collectMetricsExpressMiddleware({ registry: this.metricsRegistry, collectNodeMetrics: true }));
    }

    this.serverInstance.use(httpLogger({ logger: this.logger, ignorePaths: ['/metrics'] }));

    if (this.config.get('server.response.compression.enabled')) {
      this.serverInstance.use(compression(this.config.get('server.response.compression.options') as compression.CompressionOptions));
    }

    this.serverInstance.use(bodyParser.json(this.config.get('server.request.payload')));

    const ignorePathRegex = new RegExp(`^${this.config.get('openapiConfig.basePath')}/.*`, 'i');
    const apiSpecPath = this.config.get('openapiConfig.filePath');
    this.serverInstance.use(OpenApiMiddleware({ apiSpec: apiSpecPath, validateRequests: true, ignorePaths: ignorePathRegex }));
  }

  private registerPostRoutesMiddleware(): void {
    this.serverInstance.use(getErrorHandlerMiddleware());
    this.serverInstance.use(handleError);
  }
}
