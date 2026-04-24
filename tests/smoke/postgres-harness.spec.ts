import { describe, expect, it } from 'vitest';
import { createPostgresTestHarness } from '../../packages/test-kit/src/postgres-test-harness';

describe('postgres test harness', () => {
  it('can execute a simple query against an isolated database', async () => {
    const harness = await createPostgresTestHarness();

    try {
      const rows = await harness.query<{ value: number }>('select 1 as value');
      expect(rows).toEqual([{ value: 1 }]);
    } finally {
      await harness.close();
    }
  });
});
