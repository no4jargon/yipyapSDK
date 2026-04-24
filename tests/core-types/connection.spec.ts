import { describe, expect, it } from 'vitest';
import {
  connectionStatuses,
  connectionStatusReasons,
  normalizeTitle
} from '../../packages/core-types/src/index';

describe('core types: connection invariants', () => {
  it('exports the canonical connection statuses', () => {
    expect(connectionStatuses).toEqual([
      'pending',
      'qr_ready',
      'connecting',
      'connected',
      'degraded',
      'reconnecting',
      'disconnected',
      'reauth_required',
      'failed'
    ]);
  });

  it('exports the canonical connection status reasons', () => {
    expect(connectionStatusReasons).toEqual([
      'none',
      'network_loss',
      'logged_out',
      'auth_invalid',
      'provider_reject',
      'protocol_change_suspected',
      'manual_disconnect',
      'unknown'
    ]);
  });

  it('normalizes titles for case-insensitive lookup', () => {
    expect(normalizeTitle('  Project Alpha  ')).toBe('project alpha');
  });
});
