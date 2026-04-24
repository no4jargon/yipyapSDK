import { createBackpressureGate } from '../../../packages/query-api/src/operational';

export interface ProviderWorkerJob {
  jobType: string;
  connectionId: string;
}

export function createProviderWorkerRuntime(input: {
  maxInFlight: number;
  runJob: (job: ProviderWorkerJob) => Promise<void>;
}): { execute: (job: ProviderWorkerJob) => Promise<void> } {
  const gate = createBackpressureGate({ maxInFlight: input.maxInFlight });

  return {
    async execute(job) {
      const release = gate.enter();
      try {
        await input.runJob(job);
      } finally {
        release();
      }
    }
  };
}
