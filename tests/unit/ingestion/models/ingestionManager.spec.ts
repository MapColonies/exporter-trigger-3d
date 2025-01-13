import jsLogger from '@map-colonies/js-logger';
import { OperationStatus } from '@map-colonies/mc-priority-queue';
import httpStatus from 'http-status-codes';
import { faker } from '@faker-js/faker';
import { container } from 'tsyringe';
import { register } from 'prom-client';
import { getApp } from '../../../../src/app';
import { AppError } from '../../../../src/common/appError';
import { SERVICES } from '../../../../src/common/constants';
import { IngestionResponse, Payload } from '../../../../src/common/interfaces';
import { IngestionManager } from '../../../../src/ingestion/models/ingestionManager';
import {
  configProviderMock,
  createPayload,
  jobManagerClientMock,
  queueFileHandlerMock,
  createFile,
  createJobParameters,
} from '../../../helpers/mockCreator';

let ingestionManager: IngestionManager;
let payload: Payload;

describe('ingestionManager', () => {
  beforeEach(async () => {
    payload = createPayload('model');

    await getApp({
      override: [
        { token: SERVICES.QUEUE_FILE_HANDLER, provider: { useValue: queueFileHandlerMock } },
        { token: SERVICES.JOB_MANAGER_CLIENT, provider: { useValue: jobManagerClientMock } },
        { token: SERVICES.PROVIDER, provider: { useValue: configProviderMock } },
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
      ],
    });

    register.clear();
    ingestionManager = container.resolve(IngestionManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
    register.clear();
  });

  describe('createJob Service', () => {
    it('returns create job response', async () => {
      // Arrange
      const response: IngestionResponse = {
        jobId: '1234',
        status: OperationStatus.PENDING,
      };
      jobManagerClientMock.createJob.mockResolvedValue({ id: '1234', status: OperationStatus.PENDING });
      // Act
      const modelResponse = await ingestionManager.createJob(payload);
      //Assert
      expect(modelResponse).toMatchObject(response);
    });

    it('rejects if jobManager fails', async () => {
      // Arrange
      jobManagerClientMock.createJob.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));
      // Act && Assert
      await expect(ingestionManager.createJob(payload)).rejects.toThrow(AppError);
    });
  });

  describe('createModel Service', () => {
    it('resolves without error when everything is ok', async () => {
      // Arrange
      const jobId = faker.string.uuid();
      const parameters = createJobParameters();
      const filesAmount = faker.number.int({ min: 1, max: 8 });
      queueFileHandlerMock.createQueueFile.mockResolvedValue(undefined);
      configProviderMock.streamModelPathsToQueueFile.mockResolvedValue(filesAmount);
      for (let i = 0; i < filesAmount; i++) {
        queueFileHandlerMock.readline.mockReturnValueOnce(createFile());
      }
      queueFileHandlerMock.readline.mockReturnValueOnce(createFile(true));
      queueFileHandlerMock.readline.mockReturnValueOnce(null);
      jobManagerClientMock.getJob.mockResolvedValue({ parameters });
      jobManagerClientMock.updateJob.mockResolvedValue(undefined);
      queueFileHandlerMock.deleteQueueFile.mockResolvedValue(undefined);

      // Act
      const response = await ingestionManager.createModel(payload, jobId);

      //Assert
      expect(response).toBeUndefined();
    });

    it(`rejects if couldn't createQueueFile queue file`, async () => {
      // Arrange
      const jobId = faker.string.uuid();
      queueFileHandlerMock.createQueueFile.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));

      // Act && Assert
      await expect(ingestionManager.createModel(payload, jobId)).rejects.toThrow(AppError);
    });

    it(`rejects if couldn't empty queue file`, async () => {
      // Arrange
      const jobId = faker.string.uuid();
      queueFileHandlerMock.deleteQueueFile.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));

      // Act && Assert
      await expect(ingestionManager.createModel(payload, jobId)).rejects.toThrow(AppError);
    });

    it('rejects if the provider failed', async () => {
      // Arrange
      const jobId = faker.string.uuid();
      queueFileHandlerMock.createQueueFile.mockResolvedValue(undefined);
      configProviderMock.streamModelPathsToQueueFile.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));

      // Act && Assert
      await expect(ingestionManager.createModel(payload, jobId)).rejects.toThrow(AppError);
    });

    it(`rejects if couldn't read from queue file`, async () => {
      // Arrange
      const jobId = faker.string.uuid();
      const filesAmount = faker.number.int({ min: 1, max: 8 });
      queueFileHandlerMock.createQueueFile.mockResolvedValue(undefined);
      configProviderMock.streamModelPathsToQueueFile.mockResolvedValue(filesAmount);
      queueFileHandlerMock.readline.mockImplementation(() => {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true);
      });
      queueFileHandlerMock.deleteQueueFile.mockResolvedValue(undefined);

      // Act && Assert
      await expect(ingestionManager.createModel(payload, jobId)).rejects.toThrow(AppError);
    });

    it('rejects if there is a problem with job manager', async () => {
      // Arrange
      const jobId = faker.string.uuid();
      const filesAmount = faker.number.int({ min: 1, max: 8 });
      queueFileHandlerMock.createQueueFile.mockResolvedValue(undefined);
      configProviderMock.streamModelPathsToQueueFile.mockResolvedValue(filesAmount);
      for (let i = 0; i < filesAmount; i++) {
        queueFileHandlerMock.readline.mockReturnValueOnce(createFile());
      }
      queueFileHandlerMock.readline.mockReturnValueOnce(null);
      jobManagerClientMock.getJob.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));
      queueFileHandlerMock.deleteQueueFile.mockResolvedValue(undefined);

      // Act && Assert
      await expect(ingestionManager.createModel(payload, jobId)).rejects.toThrow(AppError);
    });
  });
});
