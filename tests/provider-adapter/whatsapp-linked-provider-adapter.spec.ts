import { describe, expect, it } from 'vitest';
import { createWhatsAppLinkedProviderAdapter } from '../../packages/provider-whatsapp-linked/src';
import { runProviderAdapterContractTests } from './provider-adapter-contract';

runProviderAdapterContractTests('whatsapp-linked', async () => createWhatsAppLinkedProviderAdapter({ mode: 'contract-test' }));

describe('whatsapp linked provider adapter smoke gate', () => {
  it('requires an explicit smoke flag before attempting live smoke setup', async () => {
    await expect(
      createWhatsAppLinkedProviderAdapter({ mode: 'smoke' })
    ).rejects.toMatchObject({
      code: 'precondition_failed'
    });
  });
});
