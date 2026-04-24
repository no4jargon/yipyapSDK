import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../../packages/provider-adapter-interface/src/index';

export function runProviderAdapterContractTests(
  name: string,
  createAdapter: () => Promise<ProviderAdapter>
): void {
  describe(`${name} provider adapter contract`, () => {
    it('creates a session, exposes qr bootstrap state, and transitions to connected', async () => {
      const adapter = await createAdapter();

      await adapter.createSession({ connectionId: 'conn_1' });

      await expect(
        adapter.getConnectionBootstrapState('conn_1')
      ).resolves.toMatchObject({
        status: 'qr_ready',
        qrPayload: 'fake-qr:conn_1'
      });

      await adapter.connect('conn_1');

      await expect(
        adapter.getConnectionBootstrapState('conn_1')
      ).resolves.toMatchObject({
        status: 'connected'
      });
    });

    it('lists discovered conversations and paginates a seven-day history page backward', async () => {
      const adapter = await createAdapter();
      await adapter.createSession({ connectionId: 'conn_1' });

      await expect(adapter.listDiscoveredConversations('conn_1')).resolves.toMatchObject([
        {
          providerConversationId: 'conv_direct_1',
          conversationType: 'direct'
        },
        {
          providerConversationId: 'conv_group_1',
          conversationType: 'group'
        }
      ]);

      const page = await adapter.requestHistoryPage({
        connectionId: 'conn_1',
        providerConversationId: 'conv_direct_1',
        pageDirection: 'backward',
        pageSizeDays: 7
      });

      expect(page.messages).toHaveLength(2);
      expect(page.messages[0]).toMatchObject({
        providerMessageId: 'hist_direct_2'
      });
      expect(page.messages[1]).toMatchObject({
        providerMessageId: 'hist_direct_1'
      });
      expect(page.nextAnchor).toBeNull();
    });

    it('emits subscribed raw events and supports sending text, attachments, and attachment fetch', async () => {
      const adapter = await createAdapter();
      await adapter.createSession({ connectionId: 'conn_1' });

      const seenTypes: string[] = [];
      const unsubscribe = await adapter.subscribe('conn_1', async (event) => {
        seenTypes.push(event.type);
      });

      try {
        const textResult = await adapter.sendTextMessage({
          connectionId: 'conn_1',
          providerConversationId: 'conv_direct_1',
          text: 'hello from test',
          clientMessageId: 'client_1'
        });

        expect(textResult.providerMessageId).toBe('sent_text_1');

        const attachmentResult = await adapter.sendAttachmentMessage({
          connectionId: 'conn_1',
          providerConversationId: 'conv_direct_1',
          attachmentSource: {
            fileName: 'hello.txt',
            mimeType: 'text/plain',
            data: Buffer.from('hello attachment')
          },
          caption: 'greeting',
          clientMessageId: 'client_2'
        });

        expect(attachmentResult.providerMessageId).toBe('sent_attachment_1');

        const fetched = await adapter.fetchAttachment({
          connectionId: 'conn_1',
          providerAttachmentRef: 'att_hist_1'
        });

        expect(fetched.mimeType).toBe('text/plain');
        expect(fetched.data.toString('utf8')).toBe('history attachment');
        expect(seenTypes).toEqual([
          'message.sent',
          'attachment.sent'
        ]);
      } finally {
        await unsubscribe();
      }
    });
  });
}
