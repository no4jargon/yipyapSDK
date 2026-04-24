import type { PostgresEventLogRepository } from '../../event-log/src/event-log-repository';
import type { PostgresExportCursorRepository } from '../../storage/src/export-cursor-repository';
import type { PostgresMessageRepository } from '../../storage/src/message-repository';

interface ExportServiceDeps {
  eventLogRepository: PostgresEventLogRepository;
  messageRepository: PostgresMessageRepository;
  exportCursorRepository: PostgresExportCursorRepository;
  createId: (prefix: string) => string;
}

export class ExportService {
  constructor(private readonly deps: ExportServiceDeps) {}

  async getOrCreateCursor(input: { tenantId: string; cursorName: string }) {
    const existing = await this.deps.exportCursorRepository.getByName(input);
    if (existing) {
      return existing;
    }
    const now = new Date();
    return this.deps.exportCursorRepository.create({
      id: this.deps.createId('cursor'),
      tenantId: input.tenantId,
      cursorName: input.cursorName,
      lastIngestSeq: BigInt(0),
      createdAt: now,
      updatedAt: now
    });
  }

  async advanceCursor(input: { tenantId: string; cursorName: string; lastIngestSeq: bigint }) {
    const cursor = await this.getOrCreateCursor({ tenantId: input.tenantId, cursorName: input.cursorName });
    await this.deps.exportCursorRepository.update({ ...cursor, lastIngestSeq: input.lastIngestSeq, updatedAt: new Date() });
  }

  async exportEvents(input: { tenantId: string; cursorName: string; limit: number; afterIngestSeq?: bigint }) {
    const cursor = await this.getOrCreateCursor({ tenantId: input.tenantId, cursorName: input.cursorName });
    return this.deps.eventLogRepository.listByTenant({ tenantId: input.tenantId, afterIngestSeq: input.afterIngestSeq ?? cursor.lastIngestSeq, limit: input.limit });
  }

  async exportMessages(input: { tenantId: string; afterIngestSeq: bigint; limit: number }) {
    const messages = await this.deps.messageRepository.listByTenant({ tenantId: input.tenantId, afterIngestSeq: input.afterIngestSeq });
    return messages.slice(0, input.limit);
  }
}
