import { describe, expect, it } from 'vitest';
import {
  connectionBootstrapStatuses,
  providerEventFamilies,
  supportedHistoryPageDirections
} from '../../packages/provider-adapter-interface/src/index';

describe('provider adapter interface exports', () => {
  it('exports canonical bootstrap statuses', () => {
    expect(connectionBootstrapStatuses).toEqual([
      'pending',
      'qr_ready',
      'connecting',
      'connected',
      'reauth_required',
      'failed'
    ]);
  });

  it('exports canonical raw event families and history directions', () => {
    expect(providerEventFamilies).toEqual(['provider_raw']);
    expect(supportedHistoryPageDirections).toEqual(['backward']);
  });
});
