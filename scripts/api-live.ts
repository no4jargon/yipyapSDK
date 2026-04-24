import { createPlatformServer } from '../apps/api/src/platform-server';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';

void main();

async function main(): Promise<void> {
  const app = await createPlatformServer({
    objectStorageDir: process.env.YIPYAP_OBJECT_STORAGE_DIR,
    liveAuthDir: process.env.YIPYAP_WHATSAPP_AUTH_DIR,
    deviceLabel: process.env.YIPYAP_WHATSAPP_DEVICE_LABEL ?? 'YipYap Demo',
    resetStateOnBoot: process.env.YIPYAP_RESET_STATE_ON_BOOT === '1'
  });

  app.server.listen(port, host, () => {
    console.log(`YipYap API listening on http://${host}:${port} (provider=live)`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
