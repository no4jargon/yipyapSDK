import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPlatformServer } from '../../apps/api/src/platform-server';
import type { ProviderAdapter, ProviderAttachmentFetchResult, ProviderConversation, ProviderHistoryPage, ProviderRawEvent, ProviderSendResult } from '../../packages/provider-adapter-interface/src';

describe('platform server reset-on-boot', () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    cleanup = [];
  });

  it('clears configured object storage on boot when resetStateOnBoot is enabled', async () => {
    const root = '/tmp/yipyap-reset-object-storage';
    await mkdir(join(root, 'attachments'), { recursive: true });
    await writeFile(join(root, 'attachments/stale.txt'), 'stale');

    const app = await createPlatformServer({
      providerAdapter: new NoopProviderAdapter(),
      objectStorageDir: root,
      resetStateOnBoot: true
    });
    cleanup.push(async () => app.close());

    await expect(readFile(join(root, 'attachments/stale.txt'), 'utf8')).rejects.toBeDefined();
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
