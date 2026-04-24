import type { ProviderConversation, ProviderRawEvent } from '../../provider-adapter-interface/src';

export interface SmokeHistoryHydrationStatus {
  isReady: boolean;
  sawHistorySet: boolean;
  recentEventCount: number;
}

export interface SmokeValidationPlan {
  historyConversationId: string | null;
  attachmentRef: string | null;
}

export async function completeSmokeCliRun(input: {
  succeeded: boolean;
  flushDelayMs?: number;
  delayImpl?: (ms: number) => Promise<void>;
  exitImpl?: (code: number) => void;
}): Promise<void> {
  if (!input.succeeded) {
    return;
  }

  const delayImpl = input.delayImpl ?? defaultDelay;
  const exitImpl = input.exitImpl ?? defaultExit;
  await delayImpl(input.flushDelayMs ?? 25);
  exitImpl(0);
}

export function getSmokeHistoryHydrationStatus(input: {
  connectedAt: Date;
  now: Date;
  historyWaitMs: number;
  historySettleMs: number;
  events: ProviderRawEvent[];
}): SmokeHistoryHydrationStatus {
  const relevantEvents = input.events.filter((event) => event.occurredAt.getTime() >= input.connectedAt.getTime());
  const historySetEvents = relevantEvents.filter((event) => event.type === 'messaging-history.set');
  const firstHistorySetAt = historySetEvents[0]?.occurredAt ?? null;
  const hardWaitElapsed = input.now.getTime() - input.connectedAt.getTime() >= input.historyWaitMs;
  const settledAfterHistorySet = firstHistorySetAt !== null
    ? input.now.getTime() - firstHistorySetAt.getTime() >= input.historySettleMs
    : false;

  return {
    isReady: hardWaitElapsed || settledAfterHistorySet,
    sawHistorySet: firstHistorySetAt !== null,
    recentEventCount: relevantEvents.length
  };
}

export function buildSmokeValidationPlan(input: {
  conversations: ProviderConversation[];
  events: ProviderRawEvent[];
  expectedTitles?: string[];
}): SmokeValidationPlan {
  const expected = findExpectedConversations({
    conversations: input.conversations,
    expectedTitles: input.expectedTitles ?? []
  });

  return {
    historyConversationId: expected[0]?.providerConversationId ?? input.conversations[0]?.providerConversationId ?? null,
    attachmentRef: findFirstAttachmentRef(input.events)
  };
}

export function findExpectedConversations(input: {
  conversations: ProviderConversation[];
  expectedTitles: string[];
}): ProviderConversation[] {
  const matches: ProviderConversation[] = [];
  const seenConversationIds = new Set<string>();

  for (const expectedTitle of input.expectedTitles.map(normalize).filter((value) => value.length > 0)) {
    const match = input.conversations.find((conversation) => {
      const title = normalize(conversation.title);
      return title.includes(expectedTitle) || expectedTitle.includes(title);
    });
    if (!match || seenConversationIds.has(match.providerConversationId)) {
      continue;
    }
    seenConversationIds.add(match.providerConversationId);
    matches.push(match);
  }

  return matches;
}

function findFirstAttachmentRef(events: ProviderRawEvent[]): string | null {
  for (const event of events) {
    if (event.type !== 'messages.upsert' && event.type !== 'messaging-history.set') {
      continue;
    }
    const messages = Array.isArray(event.payload.messages) ? event.payload.messages : [];
    for (const candidate of messages) {
      const message = asRecord(candidate);
      const key = asRecord(message?.key);
      const content = asRecord(message?.message);
      const messageId = typeof key?.id === 'string' ? key.id : null;
      if (!messageId) {
        continue;
      }
      if (content?.imageMessage || content?.documentMessage || content?.videoMessage || content?.audioMessage) {
        return messageId;
      }
    }
  }
  return null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultExit(code: number): void {
  process.exit(code);
}
