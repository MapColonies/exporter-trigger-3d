import { CommonPrefix, ListObjectsCommand, ListObjectsRequest, S3Client, S3ClientConfig, S3ServiceException, _Object } from '@aws-sdk/client-s3';
import { type commonS3FullV1Type } from '@map-colonies/schemas';
import { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { Tracer } from '@opentelemetry/api';
import { withSpanAsyncV4, withSpanV4 } from '@map-colonies/telemetry';
import { QueueFileHandler } from '../handlers/queueFileHandler';
import { AppError } from '../common/appError';
import { SERVICES } from '../common/constants';
import { LogContext, Provider } from '../common/interfaces';

@injectable()
export class S3Provider implements Provider {
  private readonly s3: S3Client;
  private filesCount: number;
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) protected readonly logger: Logger,
    @inject(SERVICES.TRACER) public readonly tracer: Tracer,
    @inject(SERVICES.PROVIDER_CONFIG) protected readonly s3Config: commonS3FullV1Type,
    @inject(SERVICES.QUEUE_FILE_HANDLER) protected readonly queueFileHandler: QueueFileHandler
  ) {
    const s3ClientConfig: S3ClientConfig = {
      endpoint: `${this.s3Config.protocol}//${this.s3Config.host}:${this.s3Config.port}`,
      forcePathStyle: this.s3Config.forcePathStyle,
      credentials: {
        accessKeyId: this.s3Config.accessKeyId,
        secretAccessKey: this.s3Config.secretAccessKey,
      },
      region: this.s3Config.region,
    };

    this.s3 = new S3Client(s3ClientConfig);
    this.filesCount = 0;

    this.logContext = {
      fileName: __filename,
      class: S3Provider.name,
    };
  }

  @withSpanAsyncV4
  public async streamModelPathsToQueueFile(modelId: string, pathToTileset: string, modelName: string): Promise<number> {
    const logContext = { ...this.logContext, function: this.streamModelPathsToQueueFile.name };
    /* eslint-disable @typescript-eslint/naming-convention */
    const params: ListObjectsRequest = {
      Bucket: this.s3Config.bucket,
      Delimiter: '/',
      Prefix: pathToTileset + '/',
    };

    await this.listS3Recursively(modelId, params);

    if (await this.queueFileHandler.checkIfTempFileEmpty(modelId)) {
      throw new AppError(httpStatus.NOT_FOUND, `Model ${modelName} doesn't exists in bucket ${this.s3Config.bucket}! Path: ${pathToTileset}`, true);
    }

    this.logger.info({
      msg: 'Finished listing the files',
      logContext,
      filesCount: this.filesCount,
      modelName,
      modelId,
    });
    const lastFileCount = this.filesCount;
    this.filesCount = 0;

    return lastFileCount;
  }

  @withSpanAsyncV4
  private async listS3Recursively(modelId: string, params: ListObjectsRequest): Promise<void> {
    const logContext = { ...this.logContext, function: this.listS3Recursively.name };
    try {
      const listObject = new ListObjectsCommand(params);
      const data = await this.s3.send(listObject);

      if (data.Contents) {
        await this.writeFileContent(modelId, data.Contents);
      }

      if (data.CommonPrefixes) {
        await this.writeFolderContent(modelId, data.CommonPrefixes);
      }

      if (data.IsTruncated === true) {
        const nextParams: ListObjectsRequest = {
          Bucket: this.s3Config.bucket,
          Delimiter: '/',
          Prefix: data.Prefix,
          Marker: data.NextMarker,
        };
        await this.listS3Recursively(modelId, nextParams);
      }

      this.logger.debug({
        msg: `Listed ${this.filesCount} files`,
        logContext,
        modelId,
      });
    } catch (err) {
      this.logger.error({
        msg: 'failed in listing the model',
        logContext,
        modelId,
        err,
      });
      this.handleS3Error(this.s3Config.bucket, err);
    }
  }

  @withSpanAsyncV4
  private async writeFileContent(modelId: string, contents: _Object[]): Promise<void> {
    for (const content of contents) {
      if (content.Key == undefined) {
        throw new AppError(httpStatus.NO_CONTENT, 'found content without file name', true);
      }
      await this.queueFileHandler.writeFileNameToQueueFile(modelId, content.Key);
      this.filesCount++;
    }
  }

  @withSpanAsyncV4
  private async writeFolderContent(modelId: string, CommonPrefixes: CommonPrefix[]): Promise<void> {
    for (const commonPrefix of CommonPrefixes) {
      if (commonPrefix.Prefix != undefined) {
        const nextParams: ListObjectsRequest = {
          Bucket: this.s3Config.bucket,
          Delimiter: '/',
          Prefix: commonPrefix.Prefix,
        };
        await this.listS3Recursively(modelId, nextParams);
      }
    }
  }

  @withSpanV4
  private handleS3Error(s3Bucket: string, error: unknown): never {
    let statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    let message = "Didn't throw a S3 exception in file";

    if (error instanceof S3ServiceException) {
      statusCode = error.$metadata.httpStatusCode ?? statusCode;
      message = `${error.name}, message: ${error.message}, bucket: ${s3Bucket}`;
    }

    throw new AppError(statusCode, message, true);
  }
}
