import { describe, expect, it, vi } from 'vitest';
import { completeSmokeCliRun } from '../../packages/provider-whatsapp-linked/src/smoke-flow';

describe('whatsapp linked smoke cli completion', () => {
  it('forces a clean successful exit after teardown completes', async () => {
    const exitImpl = vi.fn();
    const delayImpl = vi.fn(async () => {});

    await completeSmokeCliRun({
      succeeded: true,
      flushDelayMs: 25,
      delayImpl,
      exitImpl
    });

    expect(delayImpl).toHaveBeenCalledWith(25);
    expect(exitImpl).toHaveBeenCalledWith(0);
  });

  it('does not force process exit on failure', async () => {
    const exitImpl = vi.fn();
    const delayImpl = vi.fn(async () => {});

    await completeSmokeCliRun({
      succeeded: false,
      flushDelayMs: 25,
      delayImpl,
      exitImpl
    });

    expect(delayImpl).not.toHaveBeenCalled();
    expect(exitImpl).not.toHaveBeenCalled();
  });
});
