import fs from 'fs';
import os from 'os';
import config from 'config';
import jsLogger from '@map-colonies/js-logger';
import { container } from 'tsyringe';
import { faker } from '@faker-js/faker';
import { AppError } from '../../../src/common/appError';
import { S3Provider } from '../../../src/providers/s3Provider';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { S3Config } from '../../../src/common/interfaces';
import { S3Helper } from '../../helpers/s3Helper';
import { QueueFileHandler } from '../../../src/handlers/queueFileHandler';

describe('S3Provider tests', () => {
  let provider: S3Provider;
  let s3Helper: S3Helper;
  let queueFileHandler: QueueFileHandler;

  const queueFilePath = os.tmpdir();
  const s3Config = config.get<S3Config>('S3');

  beforeAll(async () => {
    await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.PROVIDER_CONFIG, provider: { useValue: s3Config } },
      ],
    });
    provider = container.resolve(S3Provider);
    s3Helper = container.resolve(S3Helper);
    queueFileHandler = container.resolve(QueueFileHandler);

    await s3Helper.createBucket();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await s3Helper.clearBucket();
    await s3Helper.deleteBucket();
    s3Helper.killS3();
  });

  describe('streamModelPathsToQueueFile', () => {
    it('returns all the files from S3', async () => {
      const modelId = faker.word.sample();
      const modelName = faker.word.sample();
      const pathToTileset = faker.word.sample();
      const fileLength = faker.number.int({ min: 1, max: 5 });
      const expectedFiles: string[] = [];
      for (let i = 0; i < fileLength; i++) {
        const file = faker.word.sample();
        await s3Helper.createFileOfModel(pathToTileset, file);
        expectedFiles.push(`${pathToTileset}/${file}`);
      }
      await queueFileHandler.createQueueFile(modelId);
      await s3Helper.createFileOfModel(pathToTileset, 'subDir/file');
      expectedFiles.push(`${pathToTileset}/subDir/file`);

      await provider.streamModelPathsToQueueFile(modelId, pathToTileset, modelName);
      const result = fs.readFileSync(`${queueFilePath}/${modelId}`, 'utf-8');

      for (const file of expectedFiles) {
        expect(result).toContain(file);
      }
      await queueFileHandler.deleteQueueFile(modelId);
    });

    it('returns error string when model is not in the agreed folder', async () => {
      const modelId = faker.word.sample();
      await queueFileHandler.createQueueFile(modelId);
      const modelName = faker.word.sample();
      const pathToTileset = faker.word.sample();

      const result = async () => {
        await provider.streamModelPathsToQueueFile(modelId, pathToTileset, modelName);
      };

      await expect(result).rejects.toThrow(AppError);
      await queueFileHandler.deleteQueueFile(modelId);
    });
  });
});
