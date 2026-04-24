import qrcode from 'qrcode-terminal';
import type { ProviderRawEvent } from '../packages/provider-adapter-interface/src';
import { createWhatsAppLinkedProviderAdapter, type SmokeCloseableProviderAdapter } from '../packages/provider-whatsapp-linked/src';
import { buildSmokeValidationPlan, completeSmokeCliRun, getSmokeHistoryHydrationStatus } from '../packages/provider-whatsapp-linked/src/smoke-flow';
import { buildSmokeReport } from '../packages/provider-whatsapp-linked/src/smoke-report';

const connectionId = process.env.YIPYAP_SMOKE_CONNECTION_ID ?? 'smoke_connection_1';
const pollIntervalMs = Number(process.env.YIPYAP_SMOKE_POLL_INTERVAL_MS ?? '1000');
const timeoutMs = Number(process.env.YIPYAP_SMOKE_TIMEOUT_MS ?? '300000');
const discoveryWaitMs = Number(process.env.YIPYAP_SMOKE_DISCOVERY_WAIT_MS ?? '30000');
const historyWaitMs = Number(process.env.YIPYAP_SMOKE_HISTORY_WAIT_MS ?? '45000');
const historySettleMs = Number(process.env.YIPYAP_SMOKE_HISTORY_SETTLE_MS ?? '5000');
const recentWindowHours = Number(process.env.YIPYAP_SMOKE_RECENT_WINDOW_HOURS ?? '24');
const expectedChatTitles = (process.env.YIPYAP_SMOKE_EXPECT_CHAT_TITLES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

async function main(): Promise<boolean> {
  console.log('starting whatsapp linked smoke flow');
  console.log(`connection_id=${connectionId}`);
  console.log('waiting for QR readiness');

  const adapter = await createWhatsAppLinkedProviderAdapter({ mode: 'smoke', allowSmoke: true });
  let smokeClosed = false;
  const seenEvents: ProviderRawEvent[] = [];
  const unsubscribe = await adapter.subscribe(connectionId, async (event) => {
    if (event.type === 'messages.upsert' || event.type === 'messaging-history.set') {
      seenEvents.push(event);
      const messageCount = Array.isArray(event.payload.messages) ? event.payload.messages.length : 0;
      console.log(`[event] ${event.type} messages=${messageCount}`);
    }
  });

  try {
    await adapter.createSession({ connectionId });

    const startedAt = Date.now();
    let connectedAt: Date | null = null;
    let summarized = false;
    let lastQrPayload: string | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      const state = await adapter.getConnectionBootstrapState(connectionId);
      console.log(`[status] ${state.status}`);

      if (state.qrPayload && state.qrPayload !== lastQrPayload) {
        lastQrPayload = state.qrPayload;
        console.log('[qr] received new QR payload');
        qrcode.generate(state.qrPayload, { small: true });
        console.log('scan the QR code above with WhatsApp on your phone');
      }

      if (state.status === 'connected' && connectedAt === null) {
        connectedAt = new Date();
        console.log('[connected] waiting for conversation discovery and history hydration');
      }

      if (connectedAt !== null && !summarized) {
        const discoveryDeadline = connectedAt.getTime() + discoveryWaitMs;
        let conversations = await adapter.listDiscoveredConversations(connectionId);

        while (conversations.length === 0 && Date.now() < discoveryDeadline) {
          await delay(pollIntervalMs);
          conversations = await adapter.listDiscoveredConversations(connectionId);
        }

        const hydration = getSmokeHistoryHydrationStatus({
          connectedAt,
          now: new Date(),
          historyWaitMs,
          historySettleMs,
          events: seenEvents
        });

        if (hydration.isReady) {
          conversations = await adapter.listDiscoveredConversations(connectionId);
          const report = buildSmokeReport({
            conversations,
            events: seenEvents,
            recentWindowHours,
            now: new Date()
          });

          console.log(`[connected] discovered_conversations=${conversations.length}`);
          console.log(
            `[history] ready=true saw_history_set=${hydration.sawHistorySet} observed_events=${hydration.recentEventCount}`
          );
          console.log(
            `[recent:${recentWindowHours}h] messages_total=${report.recentMessageCounts.total} directs=${report.recentMessageCounts.directs} groups=${report.recentMessageCounts.groups} other=${report.recentMessageCounts.other}`
          );

          printSection('group conversations', report.groupSamples);
          printSection('direct conversations', report.directSamples);
          printSection(`recent group messages (${recentWindowHours}h)`, report.groupMessageSamples);
          printSection(`recent direct messages (${recentWindowHours}h)`, report.directMessageSamples);
          printSection(`recent other messages (${recentWindowHours}h)`, report.otherMessageSamples);

          if (report.recentMessageCounts.total === 0) {
            console.log(`[recent:${recentWindowHours}h] no recent messages were observed in raw history/upsert events during the smoke window`);
          }

          const validationPlan = buildSmokeValidationPlan({
            conversations,
            events: seenEvents,
            expectedTitles: expectedChatTitles
          });

          if (expectedChatTitles.length > 0) {
            console.log(`[expected-chats] requested=${expectedChatTitles.length}`);
            for (const title of expectedChatTitles) {
              const matchedConversation = conversations.find((conversation) => {
                const normalizedConversationTitle = conversation.title.trim().toLowerCase();
                const normalizedExpectedTitle = title.trim().toLowerCase();
                return normalizedConversationTitle.includes(normalizedExpectedTitle) || normalizedExpectedTitle.includes(normalizedConversationTitle);
              });
              console.log(
                matchedConversation
                  ? `[expected-chat] found title=${title} conversation=${matchedConversation.providerConversationId}`
                  : `[expected-chat] missing title=${title}`
              );
            }
          }

          await runSmokeValidation(adapter, connectionId, validationPlan);

          summarized = true;
          console.log('disconnecting smoke adapter');
          await closeSmokeAdapter(adapter, connectionId);
          smokeClosed = true;
          console.log('smoke flow reached connected state');
          return true;
        }
      }

      if (state.status === 'reauth_required' || state.status === 'failed') {
        throw new Error(`whatsapp smoke flow entered terminal state: ${state.status}`);
      }

      await delay(pollIntervalMs);
    }

    throw new Error(`whatsapp smoke flow timed out after ${timeoutMs}ms`);
  } finally {
    if (!smokeClosed) {
      await closeSmokeAdapter(adapter, connectionId);
    }
    await unsubscribe();
  }
}

async function closeSmokeAdapter(adapter: Awaited<ReturnType<typeof createWhatsAppLinkedProviderAdapter>>, connectionId: string): Promise<void> {
  if (hasCloseSession(adapter)) {
    await adapter.closeSession(connectionId);
    return;
  }
  await adapter.disconnect(connectionId);
}

function hasCloseSession(adapter: Awaited<ReturnType<typeof createWhatsAppLinkedProviderAdapter>>): adapter is SmokeCloseableProviderAdapter {
  return 'closeSession' in adapter && typeof adapter.closeSession === 'function';
}

async function runSmokeValidation(
  adapter: Awaited<ReturnType<typeof createWhatsAppLinkedProviderAdapter>>,
  connectionId: string,
  validationPlan: { historyConversationId: string | null; attachmentRef: string | null }
): Promise<void> {
  let attachmentRef = validationPlan.attachmentRef;

  if (validationPlan.historyConversationId) {
    const page = await adapter.requestHistoryPage({
      connectionId,
      providerConversationId: validationPlan.historyConversationId,
      pageDirection: 'backward',
      pageSizeDays: 7
    });
    console.log(
      `[history-page] conversation=${validationPlan.historyConversationId} messages=${page.messages.length} next_anchor=${page.nextAnchor ? 'yes' : 'no'}`
    );
    attachmentRef = attachmentRef ?? page.messages.find((message) => typeof message.attachmentRef === 'string')?.attachmentRef ?? null;
  } else {
    console.log('[history-page] skipped no discovered conversation available');
  }

  if (attachmentRef) {
    const attachment = await adapter.fetchAttachment({
      connectionId,
      providerAttachmentRef: attachmentRef
    });
    console.log(
      `[attachment-fetch] ref=${attachmentRef} file=${attachment.fileName} bytes=${attachment.data.byteLength}`
    );
    return;
  }

  console.log('[attachment-fetch] skipped no recent attachment observed during smoke window or selected history page');
}

function printSection(title: string, lines: string[]): void {
  console.log(`[${title}] count=${lines.length}`);
  for (const line of lines.slice(0, 20)) {
    console.log(`- ${line}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main()
  .then(async (succeeded) => {
    await completeSmokeCliRun({ succeeded, delayImpl: delay, exitImpl: (code) => process.exit(code) });
  })
  .catch((error: unknown) => {
    console.error('whatsapp linked smoke flow failed');
    console.error(error);
    process.exitCode = 1;
  });
