import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFakeProviderAdapter } from '../packages/provider-adapter-interface/src/fake-provider-adapter';
import { createPlatformServer } from '../apps/api/src/platform-server';
import { createDemoServer } from '../apps/demo/src/server';

const apiPort = Number(process.env.PORT ?? 4000);
const apiHost = process.env.HOST ?? '127.0.0.1';
const demoPort = Number(process.env.DEMO_PORT ?? 4010);
const demoHost = process.env.DEMO_HOST ?? '127.0.0.1';
const apiBaseUrl = process.env.YIPYAP_API_BASE_URL ?? `http://${apiHost}:${apiPort}`;

void main();

async function main(): Promise<void> {
  const providerAdapter = await createFakeProviderAdapter();
  const objectStorageDir = process.env.YIPYAP_OBJECT_STORAGE_DIR ?? join(tmpdir(), 'yipyap-demo-quickstart-storage');

  const api = await createPlatformServer({
    providerAdapter,
    objectStorageDir,
    resetStateOnBoot: true
  });
  const demo = createDemoServer({ apiBaseUrl });

  await new Promise<void>((resolve) => api.server.listen(apiPort, apiHost, resolve));
  await new Promise<void>((resolve) => demo.listen(demoPort, demoHost, resolve));

  console.log(`YipYap quickstart API listening on ${apiBaseUrl}`);
  console.log(`YipYap quickstart demo listening on http://${demoHost}:${demoPort}`);
  console.log('Open the demo, create a connection, discover conversations, select a chat, and open the inbox/timeline panes.');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await new Promise<void>((resolve, reject) => demo.close((error?: Error) => error ? reject(error) : resolve()));
      await api.close();
      process.exit(0);
    });
  }
}
