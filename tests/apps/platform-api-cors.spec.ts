import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createPlatformServer } from '../../apps/api/src/platform-server';
import type { ProviderAdapter, ProviderAttachmentFetchResult, ProviderConversation, ProviderHistoryPage, ProviderRawEvent, ProviderSendResult } from '../../packages/provider-adapter-interface/src';

describe('platform api server cors', () => {
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
  });

  it('responds to browser preflight requests for demo-origin API calls', async () => {
    const app = await createPlatformServer({ providerAdapter: new NoopProviderAdapter(), objectStorageDir: '/tmp/yipyap-platform-api-cors-test' });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await app.close();
    };
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpRequest(`http://127.0.0.1:${address.port}/connections`, 'OPTIONS', {
      origin: 'http://127.0.0.1:4010',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-tenant-id'
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('x-tenant-id');
  });

  it('sets access-control headers on normal API responses', async () => {
    const app = await createPlatformServer({ providerAdapter: new NoopProviderAdapter(), objectStorageDir: '/tmp/yipyap-platform-api-cors-test-2' });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    closeServer = async () => {
      await app.close();
    };
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected TCP address');
    }

    const response = await httpRequest(`http://127.0.0.1:${address.port}/health`, 'GET', {
      origin: 'http://127.0.0.1:4010'
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});

class NoopProviderAdapter implements ProviderAdapter {
  async createSession(): Promise<void> {}
  async getConnectionBootstrapState(): Promise<{ status: 'qr_ready'; qrPayload: string }> {
    return { status: 'qr_ready', qrPayload: 'noop' };
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async listDiscoveredConversations(): Promise<ProviderConversation[]> { return []; }
  async subscribe(_connectionId: string, _onEvent: (event: ProviderRawEvent) => Promise<void>): Promise<() => Promise<void>> {
    return async () => {};
  }
  async requestHistoryPage(): Promise<ProviderHistoryPage> { return { messages: [], nextAnchor: null }; }
  async sendTextMessage(): Promise<ProviderSendResult> { return { providerMessageId: 'noop', providerTimestamp: new Date() }; }
  async sendAttachmentMessage(): Promise<ProviderSendResult> { return { providerMessageId: 'noop_attachment', providerTimestamp: new Date() }; }
  async fetchAttachment(): Promise<ProviderAttachmentFetchResult> { return { mimeType: 'text/plain', fileName: 'noop.txt', data: Buffer.from('noop') }; }
}

async function httpRequest(url: string, method: string, headers: Record<string, string>): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
