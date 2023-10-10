import fs from 'fs/promises';
import { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { inject, injectable } from 'tsyringe';
import { QueueFileHandler } from '../handlers/queueFileHandler';
import { AppError } from '../common/appError';
import { SERVICES } from '../common/constants';
import { Provider, NFSConfig } from '../common/interfaces';

@injectable()
export class NFSProvider implements Provider {
  public constructor(
    @inject(SERVICES.PROVIDER_CONFIG) protected readonly config: NFSConfig,
    @inject(SERVICES.LOGGER) protected readonly logger: Logger,
    @inject(SERVICES.QUEUE_FILE_HANDLER) protected readonly queueFileHandler: QueueFileHandler
  ) {}

  public async streamModelPathsToQueueFile(modelId: string, pathToTileset: string): Promise<number> {
    let filesCount = 0;
    const modelPath = `${this.config.pvPath}/${pathToTileset}`;
    try {
      await fs.access(modelPath);
    } catch (error) {
      this.logger.error({ msg: 'failed to access the folder', modelId, modelPath, error });
      throw new AppError(httpStatus.NOT_FOUND, `Model ${pathToTileset} doesn't exists in the agreed folder`, true);
    }

    const folders: string[] = [pathToTileset];

    while (folders.length > 0) {
      const files = await fs.readdir(`${this.config.pvPath}/${folders[0]}`);
      this.logger.debug({ msg: 'Listing folder', folder: folders[0], filesCount, modelId });
      for (const file of files) {
        const fileStats = await fs.stat(`${this.config.pvPath}/${folders[0]}/${file}`);
        if (fileStats.isDirectory()) {
          folders.push(`${folders[0]}/${file}`);
        } else {
          try {
            await this.queueFileHandler.writeFileNameToQueueFile(modelId, `${folders[0]}/${file}`);
            filesCount++;
          } catch (error) {
            this.logger.error({ msg: `Didn't write the file: '${folders[0]}/${file}' in FS.`, modelId, error });
            throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'problem with queueFileHandler', false);
          }
        }
      }

      folders.shift();
    }

    this.logger.info({ msg: 'Finished listing the files', filesCount: filesCount, modelPath: pathToTileset, modelId });
    return filesCount;
  }
}
