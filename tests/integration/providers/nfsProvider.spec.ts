import fs from 'fs';
import os from 'os';
import config from 'config';
import { container } from 'tsyringe';
import httpStatus from 'http-status-codes';
import jsLogger from '@map-colonies/js-logger';
import { register } from 'prom-client';
import { faker } from '@faker-js/faker';
import { getApp } from '../../../src/app';
import { NFSProvider } from '../../../src/providers/nfsProvider';
import { SERVICES } from '../../../src/common/constants';
import { NFSConfig } from '../../../src/common/interfaces';
import { AppError } from '../../../src/common/appError';
import { createFile, queueFileHandlerMock } from '../../helpers/mockCreator';
import { QueueFileHandler } from '../../../src/handlers/queueFileHandler';
import { NFSHelper } from '../../helpers/nfsHelper';

describe('NFSProvider tests', () => {
  let provider: NFSProvider;
  let queueFileHandler: QueueFileHandler;
  const queueFilePath = os.tmpdir();
  const nfsConfig = config.get<NFSConfig>('NFS');
  let nfsHelper: NFSHelper;

  beforeAll(async () => {
    register.clear();
    await getApp({
      override: [
        { token: SERVICES.PROVIDER_CONFIG, provider: { useValue: nfsConfig } },
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
      ],
    });
    provider = container.resolve(NFSProvider);
    queueFileHandler = container.resolve(QueueFileHandler);
    nfsHelper = new NFSHelper(nfsConfig);
  });

  beforeEach(() => {
    nfsHelper.initNFS();
  });

  afterEach(async () => {
    await nfsHelper.cleanNFS();
    jest.clearAllMocks();
  });

  describe('streamModelPathsToQueueFile Function', () => {
    it('if model exists in the agreed folder, returns all the file paths of the model', async () => {
      const modelId = faker.string.uuid();
      await queueFileHandler.createQueueFile(modelId);
      const pathToTileset = faker.word.sample();
      const modelName = faker.word.sample();
      let expected = '';
      for (let i = 0; i < 4; i++) {
        const file = i === 3 ? `${i}${createFile(false, true)}` : `${i}${createFile()}`;
        await nfsHelper.createFileOfModel(pathToTileset, file);
        expected = `${expected}${pathToTileset}/${file}\n`;
      }

      await provider.streamModelPathsToQueueFile(modelId, pathToTileset, modelName);
      const result = fs.readFileSync(`${queueFilePath}/${modelId}`, 'utf-8');

      expect(result).toStrictEqual(expected);
      await queueFileHandler.deleteQueueFile(modelId);
    });

    it('if model does not exists in the agreed folder, throws error', async () => {
      const pathToTileset = faker.word.sample();
      const modelName = faker.word.sample();
      const modelId = faker.string.uuid();

      const result = async () => {
        await provider.streamModelPathsToQueueFile(modelId, pathToTileset, modelName);
      };

      await expect(result).rejects.toThrow(AppError);
    });

    it('if queue file handler does not work, throws error', async () => {
      register.clear();
      await getApp({
        override: [
          { token: SERVICES.PROVIDER_CONFIG, provider: { useValue: nfsConfig } },
          { token: SERVICES.QUEUE_FILE_HANDLER, provider: { useValue: queueFileHandlerMock } },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        ],
      });
      provider = container.resolve(NFSProvider);
      const pathToTileset = faker.word.sample();
      const modelName = faker.word.sample();
      const modelId = faker.string.uuid();
      const file = createFile();
      await nfsHelper.createFileOfModel(pathToTileset, file);
      queueFileHandlerMock.writeFileNameToQueueFile.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'queueFileHandler', false));

      const result = async () => {
        await provider.streamModelPathsToQueueFile(modelId, pathToTileset, modelName);
      };

      await expect(result).rejects.toThrow(AppError);
    });
  });
});
