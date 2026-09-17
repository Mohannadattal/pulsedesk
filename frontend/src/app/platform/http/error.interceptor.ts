import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthSessionStore } from '../auth/auth-session.store';
import { safeLocalReturnUrl } from '../auth/return-url';
import { PULSE_DESK_CONFIG } from '../config/app-config';
import { normalizeHttpError } from './app-error';
import { isPulseDeskApiRequest } from './api-request';

export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(PULSE_DESK_CONFIG);
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      const appError = normalizeHttpError(error);

      if (isUnauthorizedApiResponse(error, request.url, config.apiBaseUrl)) {
        if (session.requiresPasswordChange() && !isRestrictedSessionEndpoint(request.url)) {
          if (router.url !== '/set-password') void router.navigate(['/set-password']);
          return throwError(() => appError);
        }
        session.endSession();
        const currentUrl = safeLocalReturnUrl(router.url);
        const isLoginRequest = request.url.endsWith('/auth/login');
        if (!isLoginRequest && router.url !== '/sign-in') {
          void router.navigate(['/sign-in'], {
            queryParams: currentUrl ? { returnUrl: currentUrl } : undefined,
          });
        }
      }

      return throwError(() => appError);
    }),
  );
};

function isRestrictedSessionEndpoint(url: string): boolean {
  return url.endsWith('/auth/me') || url.endsWith('/auth/complete-password-change');
}

function isUnauthorizedApiResponse(
  error: unknown,
  requestUrl: string,
  apiBaseUrl: string,
): error is HttpErrorResponse {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 401 &&
    isPulseDeskApiRequest(requestUrl, { apiBaseUrl })
  );
}
