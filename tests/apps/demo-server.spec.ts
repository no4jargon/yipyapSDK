import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { createDemoServer } from '../../apps/demo/src/server';

describe('demo server', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('serves a thin inbox and timeline demo UI wired to the platform API base URL', async () => {
    const server = createDemoServer({ apiBaseUrl: 'http://127.0.0.1:9999' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGet(`http://127.0.0.1:${address.port}/`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('YipYap Demo');
    expect(response.body).toContain('http://127.0.0.1:9999');
    expect(response.body).toContain('demoInboxList');
    expect(response.body).toContain('demoTimeline');
    expect(response.body).toContain('demoInspector');
    expect(response.body).toContain('Load older messages');
    expect(response.body).toContain('Start live stream');
    expect(response.body).toContain('/proxy/events/stream?tenantId=');
    expect(response.body).toContain('/qr.svg?payload=');
  });

  it('proxies platform json requests with tenant scoping for the browser demo', async () => {
    let observedRequest: { method: string; url: string; tenantId: string | undefined; body: unknown } | null = null;
    const upstream = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      observedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        tenantId: req.headers['x-tenant-id'] as string | undefined,
        body: chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown : null
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, via: 'upstream' }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('expected upstream TCP address');
    }

    const server = createDemoServer({ apiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((error?: Error) => error ? reject(error) : resolve()));
    };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpJson(`http://127.0.0.1:${address.port}/proxy/connections`, 'POST', { workspaceUserRef: 'demo-user' }, {
      'x-tenant-id': 'tenant_proxy'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, via: 'upstream' });
    expect(observedRequest).toEqual({
      method: 'POST',
      url: '/connections',
      tenantId: 'tenant_proxy',
      body: { workspaceUserRef: 'demo-user' }
    });
  });

  it('proxies the normalized event stream with tenant and replay cursor information', async () => {
    let observedTenantId: string | undefined;
    let observedUrl: string | undefined;
    const upstream = createServer((req, res) => {
      observedTenantId = req.headers['x-tenant-id'] as string | undefined;
      observedUrl = req.url ?? '/';
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      res.write('event: message.mirrored\n');
      res.write('data: {"ingestSeq":"42","payload":{"providerMessageId":"live_1"}}\n\n');
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('expected upstream TCP address');
    }

    const server = createDemoServer({ apiBaseUrl: `http://127.0.0.1:${upstreamAddress.port}` });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((error?: Error) => error ? reject(error) : resolve()));
    };
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGet(`http://127.0.0.1:${address.port}/proxy/events/stream?tenantId=tenant_stream&afterIngestSeq=41`, {
      accept: 'text/event-stream'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('event: message.mirrored');
    expect(response.body).toContain('"providerMessageId":"live_1"');
    expect(observedTenantId).toBe('tenant_stream');
    expect(observedUrl).toBe('/events/stream?afterIngestSeq=41');
  });

  it('returns an empty successful favicon response so the demo does not log a 404 in the browser console', async () => {
    const server = createDemoServer({ apiBaseUrl: 'http://127.0.0.1:9999' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGet(`http://127.0.0.1:${address.port}/favicon.ico`);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('renders a qr svg endpoint for a provided payload', async () => {
    const server = createDemoServer({ apiBaseUrl: 'http://127.0.0.1:9999' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpGet(`http://127.0.0.1:${address.port}/qr.svg?payload=${encodeURIComponent('demo-qr-payload')}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<svg');
  });
});

async function httpGet(url: string, headers?: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function httpJson(url: string, method: 'GET' | 'POST', body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
