import { isPulseDeskApiRequest } from './api-request';

describe('isPulseDeskApiRequest', () => {
  const config = { apiBaseUrl: 'http://localhost:8000/api/v1' };

  it('accepts only the configured API origin and path boundary', () => {
    expect(isPulseDeskApiRequest('http://localhost:8000/api/v1/tickets', config)).toBe(true);
    expect(isPulseDeskApiRequest('http://localhost:8000/api/v10/tickets', config)).toBe(false);
    expect(isPulseDeskApiRequest('http://localhost:8000/health', config)).toBe(false);
  });

  it('rejects lookalike and third-party origins', () => {
    expect(isPulseDeskApiRequest('http://localhost:8000.evil.example/api/v1/tickets', config)).toBe(
      false,
    );
    expect(isPulseDeskApiRequest('https://example.com/api/v1/tickets', config)).toBe(false);
  });
});
