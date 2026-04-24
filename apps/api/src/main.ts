import { createFakeProviderAdapter } from '../../../packages/provider-adapter-interface/src/fake-provider-adapter';
import { createPlatformServer } from './platform-server';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';

void main();

async function main(): Promise<void> {
  const providerMode = process.env.YIPYAP_PROVIDER_MODE ?? 'fake';
  if (providerMode !== 'fake' && providerMode !== 'live') {
    throw new Error(`unsupported YIPYAP_PROVIDER_MODE: ${providerMode}`);
  }

  const providerAdapter = providerMode === 'fake'
    ? await createFakeProviderAdapter()
    : undefined;

  const app = await createPlatformServer({
    providerAdapter,
    objectStorageDir: process.env.YIPYAP_OBJECT_STORAGE_DIR,
    liveAuthDir: process.env.YIPYAP_WHATSAPP_AUTH_DIR,
    deviceLabel: process.env.YIPYAP_WHATSAPP_DEVICE_LABEL ?? 'YipYap Demo',
    resetStateOnBoot: process.env.YIPYAP_RESET_STATE_ON_BOOT === '1'
  });

  app.server.listen(port, host, () => {
    console.log(`YipYap API listening on http://${host}:${port} (provider=${providerMode})`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
