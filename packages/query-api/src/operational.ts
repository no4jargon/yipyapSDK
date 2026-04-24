import { AppError } from './errors';

export interface StructuredLogger {
  child(bindings: Record<string, unknown>): StructuredLogger;
  warn(entry: Record<string, unknown>): void;
}

export function createStructuredLogger(input: {
  write: (entry: Record<string, unknown>) => void;
  bindings?: Record<string, unknown>;
}): StructuredLogger {
  const bindings = input.bindings ?? {};
  return {
    child(childBindings) {
      return createStructuredLogger({
        write: input.write,
        bindings: { ...bindings, ...childBindings }
      });
    },
    warn(entry) {
      input.write({ level: 'warn', ...bindings, ...entry });
    }
  };
}

export async function retryWithBackoff<T>(input: {
  logger: StructuredLogger;
  maxAttempts: number;
  delayMs: number;
  shouldRetry: (error: unknown) => boolean;
  delayImpl?: (ms: number) => Promise<void>;
  operation: () => Promise<T>;
}): Promise<T> {
  const delayImpl = input.delayImpl ?? defaultDelay;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await input.operation();
    } catch (error) {
      if (attempt >= input.maxAttempts || !input.shouldRetry(error)) {
        throw error;
      }
      input.logger.warn({ event: 'retry.scheduled', attempt, delayMs: input.delayMs });
      await delayImpl(input.delayMs);
    }
  }
}

export function createBackpressureGate(input: { maxInFlight: number }): { enter: () => () => void } {
  let inFlight = 0;
  return {
    enter() {
      if (inFlight >= input.maxInFlight) {
        throw new AppError('precondition_failed', `backpressure limit reached: ${input.maxInFlight}`);
      }
      inFlight += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        inFlight -= 1;
      };
    }
  };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
