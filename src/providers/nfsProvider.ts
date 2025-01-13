import fs from 'fs/promises';
import { Logger } from '@map-colonies/js-logger';
import { type commonNfsV1Type } from '@map-colonies/schemas';
import httpStatus from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { Tracer } from '@opentelemetry/api';
import { withSpanAsyncV4 } from '@map-colonies/telemetry';
import { QueueFileHandler } from '../handlers/queueFileHandler';
import { AppError } from '../common/appError';
import { SERVICES } from '../common/constants';
import { Provider, LogContext } from '../common/interfaces';

@injectable()
export class NFSProvider implements Provider {
  private readonly logContext: LogContext;

  public constructor(
    @inject(SERVICES.LOGGER) protected readonly logger: Logger,
    @inject(SERVICES.TRACER) public readonly tracer: Tracer,
    @inject(SERVICES.PROVIDER_CONFIG) protected readonly config: commonNfsV1Type,
    @inject(SERVICES.QUEUE_FILE_HANDLER) protected readonly queueFileHandler: QueueFileHandler
  ) {
    this.logContext = {
      fileName: __filename,
      class: NFSProvider.name,
    };
  }

  @withSpanAsyncV4
  public async streamModelPathsToQueueFile(modelId: string, pathToTileset: string, modelName: string): Promise<number> {
    const logContext = { ...this.logContext, function: this.streamModelPathsToQueueFile.name };
    let filesCount = 0;
    const modelPath = `${this.config.pvPath}/${pathToTileset}`;
    try {
      await fs.access(modelPath);
    } catch (err) {
      this.logger.error({
        msg: 'failed to access the folder',
        logContext,
        modelId,
        modelName,
        err,
      });
      throw new AppError(httpStatus.NOT_FOUND, `Model ${modelName} doesn't exists in the agreed folder. Path: ${modelPath}`, true);
    }

    const folders: string[] = [pathToTileset];

    while (folders.length > 0) {
      const files = await fs.readdir(`${this.config.pvPath}/${folders[0]}`);
      this.logger.debug({
        msg: 'Listing folder',
        logContext,
        folder: folders[0],
        filesCount,
        modelId,
        modelName,
      });
      for (const file of files) {
        const fileStats = await fs.stat(`${this.config.pvPath}/${folders[0]}/${file}`);
        if (fileStats.isDirectory()) {
          folders.push(`${folders[0]}/${file}`);
        } else {
          try {
            await this.queueFileHandler.writeFileNameToQueueFile(modelId, `${folders[0]}/${file}`);
            filesCount++;
          } catch (err) {
            this.logger.error({
              msg: `Didn't write the file: '${folders[0]}/${file}' in FS.`,
              logContext,
              modelId,
              modelName,
              err,
            });
            throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'problem with queueFileHandler', false);
          }
        }
      }

      folders.shift();
    }

    this.logger.info({
      msg: 'Finished listing the files',
      logContext,
      filesCount: filesCount,
      modelName,
      modelId,
    });
    return filesCount;
  }
}
