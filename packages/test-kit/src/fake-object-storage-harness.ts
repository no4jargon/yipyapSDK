import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export interface FakeObjectStorageHarness {
  putObject(key: string, body: Buffer): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  dispose(): Promise<void>;
}

export async function createFakeObjectStorageHarness(): Promise<FakeObjectStorageHarness> {
  const root = await mkdtemp(join(tmpdir(), 'yipyap-object-storage-'));

  return {
    async putObject(key: string, body: Buffer): Promise<void> {
      const filePath = join(root, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, body);
    },
    async getObject(key: string): Promise<Buffer> {
      const filePath = join(root, key);
      const content = await readFile(filePath);
      return Buffer.from(content);
    },
    async dispose(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    }
  };
}
