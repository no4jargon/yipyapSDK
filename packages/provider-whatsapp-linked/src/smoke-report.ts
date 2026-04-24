import type { ProviderConversation, ProviderRawEvent } from '../../provider-adapter-interface/src';

export interface SmokeReport {
  conversationCounts: {
    total: number;
    groups: number;
    directs: number;
    other: number;
  };
  recentMessageCounts: {
    total: number;
    groups: number;
    directs: number;
    other: number;
  };
  groupSamples: string[];
  directSamples: string[];
  otherSamples: string[];
  groupMessageSamples: string[];
  directMessageSamples: string[];
  otherMessageSamples: string[];
}

export function buildSmokeReport(input: {
  conversations: ProviderConversation[];
  events: ProviderRawEvent[];
  now?: Date;
  recentWindowHours?: number;
  conversationSampleLimit?: number;
  messageSampleLimit?: number;
}): SmokeReport {
  const conversationSampleLimit = input.conversationSampleLimit ?? 10;
  const messageSampleLimit = input.messageSampleLimit ?? 10;
  const now = input.now ?? new Date();
  const recentWindowHours = input.recentWindowHours ?? 24;
  const recentThreshold = now.getTime() - recentWindowHours * 60 * 60 * 1000;

  const groups = input.conversations.filter((conversation) => inferConversationType(conversation.providerConversationId, conversation.conversationType) === 'group');
  const directs = input.conversations.filter((conversation) => inferConversationType(conversation.providerConversationId, conversation.conversationType) === 'direct');
  const others = input.conversations.filter((conversation) => inferConversationType(conversation.providerConversationId, conversation.conversationType) === 'other');

  const messageSamples = collectMessageSamples(input.events).filter((sample) => sample.occurredAt.getTime() >= recentThreshold);

  return {
    conversationCounts: {
      total: input.conversations.length,
      groups: groups.length,
      directs: directs.length,
      other: others.length
    },
    recentMessageCounts: {
      total: messageSamples.length,
      groups: messageSamples.filter((sample) => sample.conversationType === 'group').length,
      directs: messageSamples.filter((sample) => sample.conversationType === 'direct').length,
      other: messageSamples.filter((sample) => sample.conversationType === 'other').length
    },
    groupSamples: formatConversationSamples(groups, conversationSampleLimit),
    directSamples: formatConversationSamples(directs, conversationSampleLimit),
    otherSamples: formatConversationSamples(others, conversationSampleLimit),
    groupMessageSamples: messageSamples.filter((sample) => sample.conversationType === 'group').slice(0, messageSampleLimit).map(formatMessageSample),
    directMessageSamples: messageSamples.filter((sample) => sample.conversationType === 'direct').slice(0, messageSampleLimit).map(formatMessageSample),
    otherMessageSamples: messageSamples.filter((sample) => sample.conversationType === 'other').slice(0, messageSampleLimit).map(formatMessageSample)
  };
}

function formatConversationSamples(conversations: ProviderConversation[], limit: number): string[] {
  return [...conversations]
    .sort((left, right) => displayConversationTitle(left).localeCompare(displayConversationTitle(right)))
    .slice(0, limit)
    .map((conversation) => `${displayConversationTitle(conversation)} | ${conversation.providerConversationId}`);
}

interface MessageSample {
  title: string;
  conversationType: 'group' | 'direct' | 'other';
  preview: string;
  occurredAt: Date;
}

function collectMessageSamples(events: ProviderRawEvent[]): MessageSample[] {
  const samples: MessageSample[] = [];

  for (const event of events) {
    if (event.type !== 'messages.upsert' && event.type !== 'messaging-history.set') {
      continue;
    }

    const messages = Array.isArray(event.payload.messages) ? event.payload.messages : [];
    for (const candidate of messages) {
      const sample = toMessageSample(candidate, event.occurredAt);
      if (sample) {
        samples.push(sample);
      }
    }
  }

  return dedupeSamples(samples);
}

function toMessageSample(candidate: unknown, fallbackOccurredAt: Date): MessageSample | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const message = candidate as Record<string, unknown>;
  const key = asRecord(message.key);
  const remoteJid = typeof key?.remoteJid === 'string' ? key.remoteJid : null;
  if (!remoteJid) {
    return null;
  }

  const preview = extractMessagePreview(asRecord(message.message));
  if (!preview) {
    return null;
  }

  return {
    title: displayTitleFromMessage(remoteJid, typeof message.pushName === 'string' ? message.pushName : null),
    conversationType: inferConversationType(remoteJid),
    preview,
    occurredAt: extractMessageOccurredAt(message, fallbackOccurredAt)
  };
}

function extractMessageOccurredAt(message: Record<string, unknown>, fallbackOccurredAt: Date): Date {
  const candidate = message.messageTimestamp;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return new Date(candidate * 1000);
  }
  if (typeof candidate === 'bigint') {
    return new Date(Number(candidate) * 1000);
  }
  if (typeof candidate === 'string') {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return new Date(parsed * 1000);
    }
  }
  return fallbackOccurredAt;
}

function extractMessagePreview(message: Record<string, unknown> | null): string | null {
  if (!message) {
    return null;
  }

  if (typeof message.conversation === 'string' && message.conversation.length > 0) {
    return truncate(message.conversation);
  }

  const extendedText = asRecord(message.extendedTextMessage);
  if (typeof extendedText?.text === 'string' && extendedText.text.length > 0) {
    return truncate(extendedText.text);
  }

  const image = asRecord(message.imageMessage);
  if (typeof image?.caption === 'string' && image.caption.length > 0) {
    return `[image] ${truncate(image.caption)}`;
  }
  if (image) {
    return '[image]';
  }

  const video = asRecord(message.videoMessage);
  if (typeof video?.caption === 'string' && video.caption.length > 0) {
    return `[video] ${truncate(video.caption)}`;
  }
  if (video) {
    return '[video]';
  }

  if (message.documentMessage) {
    return '[document]';
  }
  if (message.audioMessage) {
    return '[audio]';
  }
  if (message.stickerMessage) {
    return '[sticker]';
  }

  return null;
}

function truncate(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function inferConversationType(jid: string, fallbackType?: ProviderConversation['conversationType']): 'group' | 'direct' | 'other' {
  if (jid.endsWith('@g.us')) {
    return 'group';
  }
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
    return 'direct';
  }
  if (fallbackType === 'group') {
    return 'group';
  }
  if (fallbackType === 'direct') {
    return 'direct';
  }
  return 'other';
}

function dedupeSamples(samples: MessageSample[]): MessageSample[] {
  const seen = new Set<string>();
  const deduped: MessageSample[] = [];
  for (const sample of samples) {
    const key = `${sample.conversationType}:${sample.title}:${sample.preview}:${sample.occurredAt.toISOString()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(sample);
  }
  return deduped;
}

function formatMessageSample(sample: MessageSample): string {
  return `${sample.title} | ${sample.conversationType} | ${sample.preview}`;
}

function displayConversationTitle(conversation: ProviderConversation): string {
  return displayTitleFromMessage(conversation.providerConversationId, conversation.title);
}

function displayTitleFromMessage(jid: string, preferredTitle: string | null): string {
  const normalizedPreferred = preferredTitle?.trim() ?? '';
  if (normalizedPreferred.length > 0) {
    return normalizedPreferred;
  }
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
    return jid.split('@')[0] ?? jid;
  }
  return jid;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
