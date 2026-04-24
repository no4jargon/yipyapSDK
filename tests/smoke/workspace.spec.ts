import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

describe('phase 1 workspace skeleton', () => {
  it('defines the expected monorepo workspace globs', () => {
    const workspace = YAML.parse(readFileSync('pnpm-workspace.yaml', 'utf8')) as {
      packages?: string[];
    };

    expect(workspace.packages).toEqual(['apps/*', 'packages/*', 'tests/*']);
  });

  it('contains the required top-level directories', () => {
    expect(existsSync('apps')).toBe(true);
    expect(existsSync('packages')).toBe(true);
    expect(existsSync('infra')).toBe(true);
    expect(existsSync('tests')).toBe(true);
  });

  it('contains the phase 1 package placeholders', () => {
    expect(existsSync('apps/api')).toBe(true);
    expect(existsSync('apps/worker')).toBe(true);
    expect(existsSync('apps/provider-worker')).toBe(true);
    expect(existsSync('packages/test-kit')).toBe(true);
    expect(existsSync('infra/docker')).toBe(true);
    expect(existsSync('infra/migrations')).toBe(true);
    expect(existsSync('tests/acceptance')).toBe(true);
  });
});
