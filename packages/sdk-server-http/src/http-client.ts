import { AppError } from '../../query-api/src/errors';

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class ServerHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
      method: 'GET'
    });
    return parseJsonResponse<T>(response);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(new URL(path, this.options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseJsonResponse<T>(response);
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T | { code?: string; message?: string };
  if (!response.ok) {
    throw new AppError('internal_error', `http request failed: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}
