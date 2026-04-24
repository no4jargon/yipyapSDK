import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('phase 2 delivered modules', () => {
  it('exposes core domain types from packages/core-types', async () => {
    const module = await import(
      pathToFileURL(resolve('packages/core-types/src/index.js')).href
    );
    expect(module.connectionStatuses).toBeDefined();
  });

  it('exposes storage repositories from packages/storage', async () => {
    const module = await import(
      pathToFileURL(resolve('packages/storage/src/index.js')).href
    );
    expect(module.PostgresConnectionRepository).toBeDefined();
  });

  it('adds the initial canonical SQL migration', async () => {
    const module = await import(
      pathToFileURL(resolve('infra/migrations/0001_initial.js')).href
    );
    expect(module.migrationSql).toContain('create table if not exists connections');
  });
});
