import { Logger } from '@map-colonies/js-logger';
import { ICreateTaskBody, JobManagerClient, OperationStatus } from '@map-colonies/mc-priority-queue';
import { inject, injectable } from 'tsyringe';
import client from 'prom-client';
import { JOB_TYPE, SERVICES } from '../../common/constants';
import { CreateJobBody, IConfig, IngestionResponse, JobParameters, Provider, TaskParameters, Payload } from '../../common/interfaces';
import { QueueFileHandler } from '../../handlers/queueFileHandler';

@injectable()
export class IngestionManager {
  //metrics
  private readonly jobsHistogram?: client.Histogram<'type'>;

  private readonly providerName: string;
  private readonly taskType: string;
  private readonly batchSize: number;
  private readonly maxConcurrency!: number;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.CONFIG) private readonly config: IConfig,
    @inject(SERVICES.JOB_MANAGER_CLIENT) private readonly jobManagerClient: JobManagerClient,
    @inject(SERVICES.PROVIDER) private readonly provider: Provider,
    @inject(SERVICES.QUEUE_FILE_HANDLER) protected readonly queueFileHandler: QueueFileHandler,
    @inject(SERVICES.METRICS_REGISTRY) registry?: client.Registry
  ) {
    if (registry !== undefined) {
      this.jobsHistogram = new client.Histogram({
        name: 'jobs_duration_seconds',
        help: 'jobs duration time (seconds)',
        buckets: config.get<number[]>('telemetry.metrics.buckets'),
        labelNames: ['type'] as const,
        registers: [registry],
      });
    }

    this.providerName = this.config.get<string>('ingestion.provider');
    this.batchSize = config.get<number>('jobManager.task.batches');
    this.taskType = config.get<string>('jobManager.task.type');
    this.maxConcurrency = this.config.get<number>('maxConcurrency');
  }

  public async createJob(payload: Payload): Promise<IngestionResponse> {
    const job: CreateJobBody = {
      resourceId: payload.modelId,
      version: '1',
      type: JOB_TYPE,
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

    const res: IngestionResponse = {
      jobID: jobResponse.id,
      status: OperationStatus.PENDING,
    };

    return res;
  }

  public async createModel(payload: Payload, jobId: string): Promise<void> {
    this.logger.info({
      msg: 'Creating job for model',
      modelId: payload.modelId,
      modelName: payload.metadata.productName,
      provider: this.providerName,
    });

    this.logger.debug({ msg: 'Starts writing content to queue file', modelId: payload.modelId, modelName: payload.metadata.productName });
    await this.queueFileHandler.createQueueFile(payload.modelId);

    try {
      const createJobTimerEnd = this.jobsHistogram?.startTimer({ type: JOB_TYPE });
      const fileCount: number = await this.provider.streamModelPathsToQueueFile(
        payload.modelId,
        payload.pathToTileset,
        payload.metadata.productName!
      );
      this.logger.debug({
        msg: 'Finished writing content to queue file. Creating Tasks',
        modelId: payload.modelId,
        modelName: payload.metadata.productName,
      });

      const tasks = this.createTasks(this.batchSize, payload.modelId);
      this.logger.info({ msg: 'Tasks created successfully', modelId: payload.modelId, modelName: payload.metadata.productName });

      await this.createTasksForJob(jobId, tasks, this.maxConcurrency);
      await this.updateFileCountAndStatusOfJob(jobId, fileCount);
      this.logger.info({ msg: 'Job created successfully', modelId: payload.modelId, modelName: payload.metadata.productName });
      if (createJobTimerEnd) {
        createJobTimerEnd();
      }
      await this.queueFileHandler.deleteQueueFile(payload.modelId);
    } catch (error) {
      this.logger.error({ msg: 'Failed in creating tasks', modelId: payload.modelId, modelName: payload.metadata.productName, error });
      await this.queueFileHandler.deleteQueueFile(payload.modelId);
      throw error;
    }
  }

  private async createTasksForJob(jobId: string, tasks: ICreateTaskBody<TaskParameters>[], maxRequests: number): Promise<void> {
    const tempTasks = [...tasks];

    while (tempTasks.length) {
      const createTasksBatch = tempTasks.splice(0, maxRequests).map(async (task) => this.jobManagerClient.createTaskForJob(jobId, task));
      await Promise.all(createTasksBatch);
    }
  }

  private createTasks(batchSize: number, modelId: string): ICreateTaskBody<TaskParameters>[] {
    const tasks: ICreateTaskBody<TaskParameters>[] = [];
    let chunk: string[] = [];
    let data: string | null = this.queueFileHandler.readline(modelId);

    while (data !== null) {
      if (this.isFileInBlackList(data)) {
        this.logger.warn({ msg: 'The file is is the black list! Ignored...', file: data, modelId });
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

  private buildTaskFromChunk(chunk: string[], modelId: string): ICreateTaskBody<TaskParameters> {
    const parameters: TaskParameters = { paths: chunk, modelId, lastIndexError: -1 };
    return { type: this.taskType, parameters };
  }

  private isFileInBlackList(data: string): boolean {
    const blackList = this.config.get<string[]>('ingestion.blackList');
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const fileExtension = data.split('.').slice(-1)[0];
    return blackList.includes(fileExtension);
  }

  private async updateFileCountAndStatusOfJob(jobId: string, fileCount: number): Promise<void> {
    const job = await this.jobManagerClient.getJob<JobParameters, TaskParameters>(jobId, false);
    const parameters: JobParameters = { ...job.parameters, filesCount: fileCount };
    await this.jobManagerClient.updateJob(jobId, { status: OperationStatus.IN_PROGRESS, parameters });
  }
}
