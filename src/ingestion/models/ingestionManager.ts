import { Logger } from '@map-colonies/js-logger';
import { ICreateTaskBody, JobManagerClient, OperationStatus } from '@map-colonies/mc-priority-queue';
import { inject, injectable } from 'tsyringe';
import client from 'prom-client';
import { withSpanAsyncV4, withSpanV4 } from '@map-colonies/telemetry';
import { Tracer, trace } from '@opentelemetry/api';
import { INFRA_CONVENTIONS, THREE_D_CONVENTIONS } from '@map-colonies/telemetry/conventions';
import { SERVICES } from '../../common/constants';
import { CreateJobBody, IngestionResponse, JobParameters, Provider, TaskParameters, Payload, LogContext } from '../../common/interfaces';
import { QueueFileHandler } from '../../handlers/queueFileHandler';
import { ConfigType } from '../../common/config';

@injectable()
export class IngestionManager {
  //metrics
  private readonly jobsHistogram?: client.Histogram<'type'>;

  private readonly providerName: string;
  private readonly taskType: string;
  private readonly batchSize: number;
  private readonly maxConcurrency!: number;
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.TRACER) public readonly tracer: Tracer,
    @inject(SERVICES.CONFIG) private readonly config: ConfigType,
    @inject(SERVICES.JOB_MANAGER_CLIENT) private readonly jobManagerClient: JobManagerClient,
    @inject(SERVICES.PROVIDER) private readonly provider: Provider,
    @inject(SERVICES.QUEUE_FILE_HANDLER) protected readonly queueFileHandler: QueueFileHandler,
    @inject(SERVICES.METRICS_REGISTRY) registry?: client.Registry
  ) {
    if (registry !== undefined) {
      this.jobsHistogram = new client.Histogram({
        name: 'jobs_duration_seconds',
        help: 'jobs duration time (seconds)',
        buckets: config.get('telemetry.metrics.buckets'),
        labelNames: ['type'] as const,
        registers: [registry],
      });
    }

    this.providerName = this.config.get('storage.provider');
    this.batchSize = config.get('jobManager.extraConfigs.taskBatches');
    this.taskType = config.get('jobManager.task.type');
    this.maxConcurrency = this.config.get('maxConcurrency');

    this.logContext = {
      fileName: __filename,
      class: IngestionManager.name,
    };
  }

  @withSpanAsyncV4
  public async createJob(payload: Payload): Promise<IngestionResponse> {
    const job: CreateJobBody = {
      resourceId: payload.modelId,
      version: '1',
      type: this.config.get('jobManager.job.type'),
      parameters: {
        metadata: payload.metadata,
        modelId: payload.modelId,
        tilesetFilename: payload.tilesetFilename,
        filesCount: 0,
        pathToTileset: payload.pathToTileset,
      },
      productType: payload.metadata.productType,
      productName: payload.metadata.productName,
      percentage: 0,
      producerName: payload.metadata.producerName,
      status: OperationStatus.PENDING,
      domain: '3D',
    };

    const jobResponse = await this.jobManagerClient.createJob<JobParameters, TaskParameters>(job);

    const spanActive = trace.getActiveSpan();
    spanActive?.setAttributes({
      [INFRA_CONVENTIONS.infra.jobManagement.jobId]: jobResponse.id,
      [INFRA_CONVENTIONS.infra.jobManagement.jobType]: this.config.get('jobManager.job.type'),
      [THREE_D_CONVENTIONS.three_d.catalogManager.catalogId]: payload.modelId,
    });

    const res: IngestionResponse = {
      jobId: jobResponse.id,
      status: OperationStatus.PENDING,
    };

    return res;
  }

  @withSpanAsyncV4
  public async createModel(payload: Payload, jobId: string): Promise<void> {
    const logContext = { ...this.logContext, function: this.createModel.name };
    this.logger.info({
      msg: 'Creating job for model',
      logContext,
      modelId: payload.modelId,
      modelName: payload.metadata.productName,
      provider: this.providerName,
    });

    const spanActive = trace.getActiveSpan();
    spanActive?.setAttributes({
      [INFRA_CONVENTIONS.infra.jobManagement.jobId]: jobId,
      [INFRA_CONVENTIONS.infra.jobManagement.jobType]: this.config.get('jobManager.job.type'),
      [THREE_D_CONVENTIONS.three_d.catalogManager.catalogId]: payload.modelId,
    });

    this.logger.debug({
      msg: 'Starts writing content to queue file',
      logContext,
      modelId: payload.modelId,
      modelName: payload.metadata.productName,
    });
    await this.queueFileHandler.createQueueFile(payload.modelId);

    try {
      const createJobTimerEnd = this.jobsHistogram?.startTimer({ type: this.config.get('jobManager.job.type') });
      const fileCount: number = await this.provider.streamModelPathsToQueueFile(
        payload.modelId,
        payload.pathToTileset,
        payload.metadata.productName!
      );
      this.logger.debug({
        msg: 'Finished writing content to queue file. Creating Tasks',
        logContext,
        modelId: payload.modelId,
        modelName: payload.metadata.productName,
      });

      const tasks = this.createTasks(this.batchSize, payload.modelId);
      this.logger.info({
        msg: 'Tasks created successfully',
        logContext,
        modelId: payload.modelId,
        modelName: payload.metadata.productName,
      });

      await this.createTasksForJob(jobId, tasks, this.maxConcurrency);
      await this.updateFileCountAndStatusOfJob(jobId, fileCount);
      this.logger.info({
        msg: 'Job created successfully',
        logContext,
        modelId: payload.modelId,
        modelName: payload.metadata.productName,
      });
      if (createJobTimerEnd) {
        createJobTimerEnd();
      }
      await this.queueFileHandler.deleteQueueFile(payload.modelId);
    } catch (err) {
      this.logger.error({
        msg: 'Failed in creating tasks',
        logContext,
        modelId: payload.modelId,
        modelName: payload.metadata.productName,
        err,
      });
      await this.queueFileHandler.deleteQueueFile(payload.modelId);
      throw err;
    }
  }

  @withSpanAsyncV4
  private async createTasksForJob(jobId: string, tasks: ICreateTaskBody<TaskParameters>[], maxRequests: number): Promise<void> {
    const tempTasks = [...tasks];

    while (tempTasks.length) {
      const createTasksBatch = tempTasks.splice(0, maxRequests).map(async (task) => this.jobManagerClient.createTaskForJob(jobId, task));
      await Promise.all(createTasksBatch);
    }
  }

  @withSpanV4
  private createTasks(batchSize: number, modelId: string): ICreateTaskBody<TaskParameters>[] {
    const logContext = { ...this.logContext, function: this.createTasks.name };
    const tasks: ICreateTaskBody<TaskParameters>[] = [];
    let chunk: string[] = [];
    let data: string | null = this.queueFileHandler.readline(modelId);

    while (data !== null) {
      if (this.isFileInBlackList(data)) {
        this.logger.warn({
          msg: 'The file is is the black list! Ignored...',
          logContext,
          file: data,
          modelId,
        });
      } else {
        chunk.push(data);

        if (chunk.length === batchSize) {
          const task = this.buildTaskFromChunk(chunk, modelId);
          tasks.push(task);
          chunk = [];
        }
      }

      data = this.queueFileHandler.readline(modelId);
    }

    // Create task from the rest of the last chunk
    if (chunk.length > 0) {
      const task = this.buildTaskFromChunk(chunk, modelId);
      tasks.push(task);
    }

    return tasks;
  }

  @withSpanAsyncV4
  private async updateFileCountAndStatusOfJob(jobId: string, fileCount: number): Promise<void> {
    const job = await this.jobManagerClient.getJob<JobParameters, TaskParameters>(jobId, false);
    const parameters: JobParameters = { ...job.parameters, filesCount: fileCount };
    await this.jobManagerClient.updateJob(jobId, { status: OperationStatus.IN_PROGRESS, parameters });
  }

  private buildTaskFromChunk(chunk: string[], modelId: string): ICreateTaskBody<TaskParameters> {
    const parameters: TaskParameters = { paths: chunk, modelId, lastIndexError: -1 };
    return { type: this.taskType, parameters };
  }

  private isFileInBlackList(data: string): boolean {
    const blackList = this.config.get('blackList');
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const fileExtension = data.split('.').slice(-1)[0];
    return blackList.includes(fileExtension);
  }
}
