import { HttpErrorResponse } from '@angular/common/http';

export type AppErrorKind =
  | 'validation'
  | 'authentication'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'network'
  | 'unavailable'
  | 'unexpected';

export interface ValidationFieldError {
  readonly field: string;
  readonly message: string;
}

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    readonly status?: number,
    readonly code?: string,
    readonly detail?: string,
    readonly validationErrors: readonly ValidationFieldError[] = [],
  ) {
    super(detail ?? 'The request could not be completed.');
    this.name = 'AppError';
  }
}

interface BackendErrorBody {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly errors?: unknown;
}

export function normalizeHttpError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (!(error instanceof HttpErrorResponse)) {
    return new AppError('unexpected');
  }

  const body = isRecord(error.error) ? (error.error as BackendErrorBody) : undefined;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  const detail = typeof body?.detail === 'string' ? body.detail : undefined;
  const validationErrors = normalizeValidationErrors(body?.errors);

  return new AppError(
    kindForStatus(error.status),
    error.status || undefined,
    code,
    detail,
    validationErrors,
  );
}

function kindForStatus(status: number): AppErrorKind {
  switch (status) {
    case 0:
      return 'network';
    case 401:
      return 'authentication';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation';
    case 503:
      return 'unavailable';
    default:
      return 'unexpected';
  }
}

function normalizeValidationErrors(value: unknown): readonly ValidationFieldError[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item['message'] !== 'string') {
      return [];
    }
    const location = Array.isArray(item['location'])
      ? item['location'].filter((part): part is string | number =>
          ['string', 'number'].includes(typeof part),
        )
      : [];
    return [
      {
        field: location.filter((part) => part !== 'body' && part !== 'query').join('.'),
        message: item['message'],
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
