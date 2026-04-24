export const connectionStatuses = [
  'pending',
  'qr_ready',
  'connecting',
  'connected',
  'degraded',
  'reconnecting',
  'disconnected',
  'reauth_required',
  'failed'
] as const;

export type ConnectionStatus = (typeof connectionStatuses)[number];

export const connectionStatusReasons = [
  'none',
  'network_loss',
  'logged_out',
  'auth_invalid',
  'provider_reject',
  'protocol_change_suspected',
  'manual_disconnect',
  'unknown'
] as const;

export type ConnectionStatusReason = (typeof connectionStatusReasons)[number];

export const providers = ['whatsapp_linked'] as const;
export type Provider = (typeof providers)[number];

export interface ConnectionRecord {
  id: string;
  tenantId: string;
  workspaceUserRef: string;
  provider: Provider;
  status: ConnectionStatus;
  statusReason: ConnectionStatusReason;
  createdAt: Date;
  updatedAt: Date;
  providerAccountRef: string | null;
  deviceLabel: string | null;
  lastConnectedAt: Date | null;
  lastHeartbeatAt: Date | null;
  reauthRequiredAt: Date | null;
  disconnectedAt: Date | null;
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}
