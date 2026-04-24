import { describe, expect, it, vi } from 'vitest';
import { getHealthSnapshot } from '../../apps/api/src/health';
import { createBackpressureGate, createStructuredLogger, retryWithBackoff } from '../../packages/query-api/src/operational';

describe('final hardening operational basics', () => {
  it('produces a basic healthy snapshot from dependency checks', async () => {
    await expect(
      getHealthSnapshot({
        checks: {
          storage: async () => ({ ok: true }),
          eventLog: async () => ({ ok: true })
        }
      })
    ).resolves.toEqual({
      ok: true,
      checks: {
        storage: { ok: true },
        eventLog: { ok: true }
      }
    });
  });

  it('retries transient failures with bounded attempts and records structured logs', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const logger = createStructuredLogger({
      write(entry: Record<string, unknown>) {
        entries.push(entry);
      }
    }).child({ component: 'retry-test' });

    let attempts = 0;
    const result = await retryWithBackoff({
      logger,
      maxAttempts: 3,
      delayMs: 1,
      shouldRetry(error: unknown) {
        return (error as Error).message === 'transient';
      },
      delayImpl: async () => {},
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('transient');
        }
        return 'ok';
      }
    });

    expect(result).toBe('ok');
    expect(entries).toMatchObject([
      { level: 'warn', component: 'retry-test', attempt: 1, event: 'retry.scheduled' },
      { level: 'warn', component: 'retry-test', attempt: 2, event: 'retry.scheduled' }
    ]);
  });

  it('rejects work when the in-flight backpressure limit is reached', async () => {
    const gate = createBackpressureGate({ maxInFlight: 1 });
    const release = gate.enter();

    expect(() => gate.enter()).toThrowError(/backpressure/i);

    release();
    expect(() => gate.enter()).not.toThrow();
  });
});
