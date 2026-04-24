import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ci smoke setup', () => {
  it('defines a ci script that runs lint and tests', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.ci).toBe('pnpm lint && pnpm test');
  });
});
