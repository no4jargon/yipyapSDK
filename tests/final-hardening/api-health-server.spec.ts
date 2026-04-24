import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createHealthServer } from '../../apps/api/src/server';

describe('api health server', () => {
  afterEach(async () => {
    // no-op; each test closes its own server
  });

  it('serves /health with a healthy JSON snapshot', async () => {
    const server = createHealthServer({
      checks: {
        storage: async () => ({ ok: true }),
        eventLog: async () => ({ ok: true })
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGetJson(`http://127.0.0.1:${address.port}/health`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      checks: {
        storage: { ok: true },
        eventLog: { ok: true }
      }
    });

    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  });

  it('returns 503 for unhealthy snapshots', async () => {
    const server = createHealthServer({
      checks: {
        storage: async () => ({ ok: false })
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGetJson(`http://127.0.0.1:${address.port}/health`);
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      checks: {
        storage: { ok: false }
      }
    });

    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  });
});

async function httpGetJson(url: string): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
