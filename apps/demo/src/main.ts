import { createDemoServer } from './server';

const port = Number(process.env.DEMO_PORT ?? 4010);
const host = process.env.DEMO_HOST ?? '127.0.0.1';
const apiBaseUrl = process.env.YIPYAP_API_BASE_URL ?? 'http://127.0.0.1:4000';

const server = createDemoServer({ apiBaseUrl });
server.listen(port, host, () => {
  console.log(`YipYap demo listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    process.exit(0);
  });
}
