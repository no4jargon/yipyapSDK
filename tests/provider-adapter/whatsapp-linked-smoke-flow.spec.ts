import { describe, expect, it } from 'vitest';
import type { ProviderConversation, ProviderRawEvent } from '../../packages/provider-adapter-interface/src';
import { buildSmokeValidationPlan, findExpectedConversations, getSmokeHistoryHydrationStatus } from '../../packages/provider-whatsapp-linked/src/smoke-flow';

describe('whatsapp linked smoke flow helpers', () => {
  it('does not treat early message upserts as sufficient history hydration before the hard wait elapses', () => {
    const connectedAt = new Date('2026-01-02T00:00:00.000Z');
    const events: ProviderRawEvent[] = [
      {
        family: 'provider_raw',
        type: 'messages.upsert',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-02T00:00:05.000Z'),
        payload: {
          messages: [
            {
              key: { remoteJid: '5551234567@s.whatsapp.net' },
              message: { conversation: 'hello' }
            }
          ]
        }
      }
    ];

    const status = getSmokeHistoryHydrationStatus({
      connectedAt,
      now: new Date('2026-01-02T00:00:20.000Z'),
      historyWaitMs: 45_000,
      historySettleMs: 5_000,
      events
    });

    expect(status).toMatchObject({
      isReady: false,
      sawHistorySet: false,
      recentEventCount: 1
    });
  });

  it('waits a short settle period after the first messaging-history.set before summarizing', () => {
    const connectedAt = new Date('2026-01-02T00:00:00.000Z');
    const events: ProviderRawEvent[] = [
      {
        family: 'provider_raw',
        type: 'messaging-history.set',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-02T00:00:12.000Z'),
        payload: { messages: [] }
      }
    ];

    const tooEarly = getSmokeHistoryHydrationStatus({
      connectedAt,
      now: new Date('2026-01-02T00:00:14.000Z'),
      historyWaitMs: 45_000,
      historySettleMs: 5_000,
      events
    });
    const ready = getSmokeHistoryHydrationStatus({
      connectedAt,
      now: new Date('2026-01-02T00:00:18.000Z'),
      historyWaitMs: 45_000,
      historySettleMs: 5_000,
      events
    });

    expect(tooEarly.isReady).toBe(false);
    expect(ready).toMatchObject({
      isReady: true,
      sawHistorySet: true,
      recentEventCount: 1
    });
  });

  it('falls back to the hard history wait when no messaging-history.set arrives', () => {
    const status = getSmokeHistoryHydrationStatus({
      connectedAt: new Date('2026-01-02T00:00:00.000Z'),
      now: new Date('2026-01-02T00:00:50.000Z'),
      historyWaitMs: 45_000,
      historySettleMs: 5_000,
      events: []
    });

    expect(status).toMatchObject({
      isReady: true,
      sawHistorySet: false,
      recentEventCount: 0
    });
  });

  it('builds a smoke validation plan with one history conversation and one attachment ref from observed raw events', () => {
    const conversations: ProviderConversation[] = [
      {
        providerConversationId: '5551234567@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice'
      }
    ];
    const events: ProviderRawEvent[] = [
      {
        family: 'provider_raw',
        type: 'messages.upsert',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-02T00:00:00.000Z'),
        payload: {
          messages: [
            {
              key: { remoteJid: '5551234567@s.whatsapp.net', id: 'media_1' },
              message: {
                documentMessage: {
                  fileName: 'history.txt',
                  mimetype: 'text/plain'
                }
              }
            }
          ]
        }
      }
    ];

    expect(buildSmokeValidationPlan({ conversations, events })).toEqual({
      historyConversationId: '5551234567@s.whatsapp.net',
      attachmentRef: 'media_1'
    });
  });

  it('prefers expected chat titles when building a smoke validation plan', () => {
    const conversations: ProviderConversation[] = [
      {
        providerConversationId: 'conv_other',
        conversationType: 'direct',
        title: 'Other Chat'
      },
      {
        providerConversationId: 'conv_bhabhiji',
        conversationType: 'direct',
        title: 'Bhabhiji'
      }
    ];

    expect(
      buildSmokeValidationPlan({
        conversations,
        events: [],
        expectedTitles: ['Bhabhiji', 'Srishti Agarwal']
      })
    ).toEqual({
      historyConversationId: 'conv_bhabhiji',
      attachmentRef: null
    });
  });

  it('finds expected conversations by case-insensitive substring title matching', () => {
    const conversations: ProviderConversation[] = [
      {
        providerConversationId: 'conv_1',
        conversationType: 'direct',
        title: 'Bhabhiji'
      },
      {
        providerConversationId: 'conv_2',
        conversationType: 'direct',
        title: 'Srishti Agarwal'
      },
      {
        providerConversationId: 'conv_3',
        conversationType: 'group',
        title: 'Breakfree Meditation Challenge Mumbai'
      }
    ];

    expect(findExpectedConversations({
      conversations,
      expectedTitles: ['bhabhi', 'srishti', 'breakfree meditation challenge']
    }).map((conversation: ProviderConversation) => conversation.providerConversationId)).toEqual([
      'conv_1',
      'conv_2',
      'conv_3'
    ]);
  });

  it('skips unsupported attachment-like raw events when choosing a smoke attachment validation ref', () => {
    const conversations: ProviderConversation[] = [
      {
        providerConversationId: '5551234567@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice'
      }
    ];
    const events: ProviderRawEvent[] = [
      {
        family: 'provider_raw',
        type: 'messages.upsert',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-02T00:00:00.000Z'),
        payload: {
          messages: [
            {
              key: { remoteJid: '5551234567@s.whatsapp.net', id: 'plain_1' },
              message: { conversation: 'hello' }
            }
          ]
        }
      }
    ];

    expect(buildSmokeValidationPlan({ conversations, events })).toEqual({
      historyConversationId: '5551234567@s.whatsapp.net',
      attachmentRef: null
    });
  });
});
