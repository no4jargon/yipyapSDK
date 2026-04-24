export interface ImportScheduler {
  scheduleConversationImport(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<void>;
}

export { HistoryImportService } from './history-import-service';
