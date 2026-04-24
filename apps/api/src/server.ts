import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getHealthSnapshot, type HealthCheckResult } from './health';

export function createHealthServer(input: {
  checks: Record<string, () => Promise<HealthCheckResult>>;
}): Server {
  return createServer(async (request, response) => {
    await handleRequest(request, response, input.checks);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  checks: Record<string, () => Promise<HealthCheckResult>>
): Promise<void> {
  if (request.method !== 'GET' || request.url !== '/health') {
    response.statusCode = 404;
    response.end('not found');
    return;
  }

  const snapshot = await getHealthSnapshot({ checks });
  response.statusCode = snapshot.ok ? 200 : 503;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(snapshot));
}
