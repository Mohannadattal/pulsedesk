import { HttpErrorResponse } from '@angular/common/http';

import { normalizeHttpError } from './app-error';

describe('normalizeHttpError', () => {
  it('normalizes backend validation fields defensively', () => {
    const result = normalizeHttpError(
      new HttpErrorResponse({
        status: 422,
        error: {
          code: 'VALIDATION_ERROR',
          detail: 'Request validation failed.',
          errors: [
            { location: ['body', 'email'], message: 'Invalid email', type: 'value_error' },
            { location: null, message: 42 },
          ],
        },
      }),
    );

    expect(result.kind).toBe('validation');
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.validationErrors).toEqual([{ field: 'email', message: 'Invalid email' }]);
  });

  it.each([
    [0, 'network'],
    [401, 'authentication'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
    [503, 'unavailable'],
    [500, 'unexpected'],
  ] as const)('maps status %s to %s', (status, expectedKind) => {
    expect(normalizeHttpError(new HttpErrorResponse({ status })).kind).toBe(expectedKind);
  });

  it('does not expose arbitrary thrown values', () => {
    const result = normalizeHttpError(new Error('sensitive internal detail'));

    expect(result.kind).toBe('unexpected');
    expect(result.detail).toBeUndefined();
  });
});
