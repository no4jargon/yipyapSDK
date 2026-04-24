import { describe, expect, it } from 'vitest';
import type { ProviderConversation, ProviderRawEvent } from '../../packages/provider-adapter-interface/src';
import { buildSmokeReport } from '../../packages/provider-whatsapp-linked/src/smoke-report';

describe('whatsapp linked smoke report', () => {
  it('splits discovered conversations into group and direct samples and summarizes recent message previews', () => {
    const conversations: ProviderConversation[] = [
      {
        providerConversationId: '120363423@g.us',
        conversationType: 'group',
        title: 'Project Team'
      },
      {
        providerConversationId: '5551234567@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Alice'
      },
      {
        providerConversationId: '5559876543@s.whatsapp.net',
        conversationType: 'direct',
        title: 'Bob'
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
              key: { remoteJid: '5551234567@s.whatsapp.net' },
              pushName: 'Alice',
              messageTimestamp: 1767311100,
              message: { conversation: 'hello there' }
            },
            {
              key: { remoteJid: '120363423@g.us' },
              pushName: 'Project Team',
              messageTimestamp: 1767311400,
              message: { extendedTextMessage: { text: 'group update' } }
            }
          ]
        }
      },
      {
        family: 'provider_raw',
        type: 'messaging-history.set',
        connectionId: 'conn_1',
        occurredAt: new Date('2026-01-02T00:00:01.000Z'),
        payload: {
          messages: [
            {
              key: { remoteJid: '5559876543@s.whatsapp.net' },
              pushName: 'Bob',
              messageTimestamp: 1767222000,
              message: { imageMessage: { caption: 'old photo caption' } }
            }
          ]
        }
      }
    ];

    const report = buildSmokeReport({
      conversations,
      events,
      now: new Date('2026-01-02T00:05:00.000Z'),
      recentWindowHours: 24,
      conversationSampleLimit: 5,
      messageSampleLimit: 5
    });

    expect(report.conversationCounts).toEqual({
      total: 3,
      groups: 1,
      directs: 2,
      other: 0
    });

    expect(report.recentMessageCounts).toEqual({
      total: 2,
      groups: 1,
      directs: 1,
      other: 0
    });

    expect(report.groupSamples).toEqual([
      'Project Team | 120363423@g.us'
    ]);

    expect(report.directSamples).toEqual([
      'Alice | 5551234567@s.whatsapp.net',
      'Bob | 5559876543@s.whatsapp.net'
    ]);

    expect(report.groupMessageSamples).toEqual([
      'Project Team | group | group update'
    ]);

    expect(report.directMessageSamples).toEqual([
      'Alice | direct | hello there'
    ]);

    expect(report.otherMessageSamples).toEqual([]);
  });

  it('falls back to event occurrence time when a raw message does not carry a message timestamp', () => {
    const report = buildSmokeReport({
      conversations: [
        {
          providerConversationId: '5551234567@s.whatsapp.net',
          conversationType: 'direct',
          title: 'Alice'
        }
      ],
      events: [
        {
          family: 'provider_raw',
          type: 'messages.upsert',
          connectionId: 'conn_1',
          occurredAt: new Date('2026-01-02T00:00:00.000Z'),
          payload: {
            messages: [
              {
                key: { remoteJid: '5551234567@s.whatsapp.net' },
                pushName: 'Alice',
                message: { conversation: 'fallback timestamp works' }
              }
            ]
          }
        }
      ],
      now: new Date('2026-01-02T00:10:00.000Z')
    });

    expect(report.recentMessageCounts).toEqual({
      total: 1,
      groups: 0,
      directs: 1,
      other: 0
    });
    expect(report.directMessageSamples).toEqual([
      'Alice | direct | fallback timestamp works'
    ]);
  });

  it('fills blank conversation titles and treats @lid conversations as directs for smoke summaries', () => {
    const report = buildSmokeReport({
      conversations: [
        {
          providerConversationId: '55671382884399@lid',
          conversationType: 'unknown',
          title: ''
        },
        {
          providerConversationId: '120363347974652506@g.us',
          conversationType: 'group',
          title: ''
        }
      ],
      events: [
        {
          family: 'provider_raw',
          type: 'messages.upsert',
          connectionId: 'conn_1',
          occurredAt: new Date('2026-01-02T00:00:00.000Z'),
          payload: {
            messages: [
              {
                key: { remoteJid: '55671382884399@lid' },
                messageTimestamp: 1767311100,
                message: { conversation: 'hello from lid' }
              }
            ]
          }
        }
      ],
      now: new Date('2026-01-02T00:05:00.000Z')
    });

    expect(report.conversationCounts).toEqual({
      total: 2,
      groups: 1,
      directs: 1,
      other: 0
    });
    expect(report.directSamples).toEqual([
      '55671382884399 | 55671382884399@lid'
    ]);
    expect(report.groupSamples).toEqual([
      '120363347974652506@g.us | 120363347974652506@g.us'
    ]);
    expect(report.directMessageSamples).toEqual([
      '55671382884399 | direct | hello from lid'
    ]);
  });
});
