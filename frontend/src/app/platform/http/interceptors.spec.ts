import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionStore } from '../auth/auth-session.store';
import { TokenStorage } from '../auth/token-storage';
import { PULSE_DESK_CONFIG } from '../config/app-config';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';

describe('HTTP interceptors', () => {
  const config = { apiBaseUrl: 'http://localhost:8000/api/v1' };

  describe('authInterceptor', () => {
    let httpTesting: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([authInterceptor])),
          provideHttpClientTesting(),
          { provide: PULSE_DESK_CONFIG, useValue: config },
          { provide: TokenStorage, useValue: { read: () => 'opaque-token' } },
        ],
      });
      httpTesting = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpTesting.verify());

    it('adds the bearer token to PulseDesk API requests only', () => {
      const http = TestBed.inject(HttpClient);
      http.get(`${config.apiBaseUrl}/tickets`).subscribe();
      http.get('https://example.com/api/v1/tickets').subscribe();

      const apiRequest = httpTesting.expectOne(`${config.apiBaseUrl}/tickets`);
      const externalRequest = httpTesting.expectOne('https://example.com/api/v1/tickets');

      expect(apiRequest.request.headers.get('Authorization')).toBe('Bearer opaque-token');
      expect(externalRequest.request.headers.has('Authorization')).toBe(false);
      apiRequest.flush({});
      externalRequest.flush({});
    });

    it.each(['/auth/login', '/auth/password-reset-requests'])(
      'keeps public endpoint %s free of bearer credentials',
      (path) => {
        const http = TestBed.inject(HttpClient);
        http.post(`${config.apiBaseUrl}${path}`, {}).subscribe();

        const request = httpTesting.expectOne(`${config.apiBaseUrl}${path}`);
        expect(request.request.headers.has('Authorization')).toBe(false);
        request.flush({});
      },
    );

    it.each(['/auth/me', '/auth/complete-password-change'])(
      'sends the stored token to lifecycle endpoint %s',
      (path) => {
        const http = TestBed.inject(HttpClient);
        http.post(`${config.apiBaseUrl}${path}`, {}).subscribe();

        const request = httpTesting.expectOne(`${config.apiBaseUrl}${path}`);
        expect(request.request.headers.get('Authorization')).toBe('Bearer opaque-token');
        request.flush({});
      },
    );
  });

  describe('errorInterceptor', () => {
    const session = { endSession: vi.fn(), requiresPasswordChange: vi.fn() };
    const router = {
      url: '/tickets?status=OPEN',
      navigate: vi.fn().mockResolvedValue(true),
    };
    let httpTesting: HttpTestingController;

    beforeEach(() => {
      vi.clearAllMocks();
      session.requiresPasswordChange.mockReturnValue(false);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([errorInterceptor])),
          provideHttpClientTesting(),
          { provide: PULSE_DESK_CONFIG, useValue: config },
          { provide: AuthSessionStore, useValue: session },
          { provide: Router, useValue: router },
        ],
      });
      httpTesting = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpTesting.verify());

    it('normalizes 403 without ending the authenticated session', async () => {
      const http = TestBed.inject(HttpClient);
      const response = firstValueFrom(http.get(`${config.apiBaseUrl}/tickets`));
      httpTesting
        .expectOne(`${config.apiBaseUrl}/tickets`)
        .flush(
          { code: 'FORBIDDEN', detail: 'Insufficient permissions.' },
          { status: 403, statusText: 'Forbidden' },
        );

      await expect(response).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
      expect(session.endSession).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('ends the session once and preserves a safe return URL after 401', async () => {
      const http = TestBed.inject(HttpClient);
      const response = firstValueFrom(http.get(`${config.apiBaseUrl}/tickets`));
      httpTesting
        .expectOne(`${config.apiBaseUrl}/tickets`)
        .flush(
          { code: 'AUTHENTICATION_FAILED', detail: 'Could not validate credentials.' },
          { status: 401, statusText: 'Unauthorized' },
        );

      await expect(response).rejects.toMatchObject({ kind: 'authentication', status: 401 });
      expect(session.endSession).toHaveBeenCalledOnce();
      expect(router.navigate).toHaveBeenCalledWith(['/sign-in'], {
        queryParams: { returnUrl: '/tickets?status=OPEN' },
      });
    });

    it('preserves a legitimate restricted session when a normal business call returns 401', async () => {
      session.requiresPasswordChange.mockReturnValue(true);
      const http = TestBed.inject(HttpClient);
      const response = firstValueFrom(http.get(`${config.apiBaseUrl}/tickets`));
      httpTesting
        .expectOne(`${config.apiBaseUrl}/tickets`)
        .flush(
          { code: 'AUTHENTICATION_FAILED', detail: 'Could not validate credentials.' },
          { status: 401, statusText: 'Unauthorized' },
        );

      await expect(response).rejects.toMatchObject({ kind: 'authentication', status: 401 });
      expect(session.endSession).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/set-password']);
    });

    it('clears a stale restricted token when password completion returns 401', async () => {
      session.requiresPasswordChange.mockReturnValue(true);
      router.url = '/set-password';
      const http = TestBed.inject(HttpClient);
      const response = firstValueFrom(
        http.post(`${config.apiBaseUrl}/auth/complete-password-change`, {}),
      );
      httpTesting
        .expectOne(`${config.apiBaseUrl}/auth/complete-password-change`)
        .flush(
          { code: 'AUTHENTICATION_FAILED', detail: 'Could not validate credentials.' },
          { status: 401, statusText: 'Unauthorized' },
        );

      await expect(response).rejects.toMatchObject({ kind: 'authentication', status: 401 });
      expect(session.endSession).toHaveBeenCalledOnce();
      expect(router.navigate).toHaveBeenCalledWith(['/sign-in'], {
        queryParams: { returnUrl: '/set-password' },
      });
    });
  });
});
