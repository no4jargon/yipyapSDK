export type ErrorCode =
  | 'not_found'
  | 'invalid_argument'
  | 'conflict'
  | 'already_exists'
  | 'precondition_failed'
  | 'rate_limited'
  | 'internal_error'
  | 'provider_error'
  | 'unsupported';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}
