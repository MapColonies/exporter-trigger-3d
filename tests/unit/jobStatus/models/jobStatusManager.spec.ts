import jsLogger from '@map-colonies/js-logger';
import { OperationStatus } from '@map-colonies/mc-priority-queue';
import httpStatus from 'http-status-codes';
import { container } from 'tsyringe';
import { getApp } from '../../../../src/app';
import { AppError } from '../../../../src/common/appError';
import { SERVICES } from '../../../../src/common/constants';
import { JobStatusResponse } from '../../../../src/common/interfaces';
import { JobStatusManager } from '../../../../src/jobStatus/models/jobStatusManager';
import { jobManagerClientMock } from '../../../helpers/mockCreator';

describe('jobStatusManager', () => {
  let jobStatusManager: JobStatusManager;

  beforeAll(async () => {
    await getApp({
      override: [
        { token: SERVICES.JOB_MANAGER_CLIENT, provider: { useValue: jobManagerClientMock } },
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
      ],
    });

    jobStatusManager = container.resolve(JobStatusManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('#checkStatus', () => {
    it('return job status manager', async function () {
      const jobId = '123';
      const expectedResponse: JobStatusResponse = {
        percentage: 100,
        status: OperationStatus.COMPLETED,
      };
      jobManagerClientMock.getJob.mockResolvedValue(expectedResponse);

      const response = await jobStatusManager.checkStatus(jobId);

      expect(response).toMatchObject(expectedResponse);
    });

    it('rejects if jobManager fails', async () => {
      const jobId = '123';
      jobManagerClientMock.getJob.mockRejectedValue(new AppError(httpStatus.INTERNAL_SERVER_ERROR, '', true));

      await expect(jobStatusManager.checkStatus(jobId)).rejects.toThrow(AppError);
    });
  });
});
