import { describe, expect, it } from 'vitest';
import { createFakeObjectStorageHarness } from '../../packages/test-kit/src/fake-object-storage-harness';

describe('fake object storage harness', () => {
  it('stores and retrieves objects by key', async () => {
    const storage = await createFakeObjectStorageHarness();

    try {
      await storage.putObject('attachments/test.txt', Buffer.from('hello world'));
      const object = await storage.getObject('attachments/test.txt');

      expect(object.toString('utf8')).toBe('hello world');
    } finally {
      await storage.dispose();
    }
  });
});
