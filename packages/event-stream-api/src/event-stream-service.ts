export interface StreamedEvent {
  eventType: string;
  eventFamily: 'provider_raw' | 'normalized' | 'system';
  ingestSeq: bigint;
}

export class EventStreamService {
  private readonly subscribers = new Set<(event: StreamedEvent) => Promise<void>>();

  subscribeNormalizedEvents(handler: (event: StreamedEvent) => Promise<void>): () => Promise<void> {
    this.subscribers.add(handler);
    return async () => {
      this.subscribers.delete(handler);
    };
  }

  async publish(event: StreamedEvent): Promise<void> {
    if (event.eventFamily !== 'normalized') {
      return;
    }
    for (const handler of this.subscribers) {
      await handler(event);
    }
  }
}
