import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { PULSE_DESK_CONFIG } from '../config/app-config';
import { TokenStorage } from '../auth/token-storage';
import { isPulseDeskApiRequest } from './api-request';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(PULSE_DESK_CONFIG);
  const token = inject(TokenStorage).read();

  if (!token || !isPulseDeskApiRequest(request.url, config) || isPublicAuthRequest(request.url)) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    }),
  );
};

function isPublicAuthRequest(url: string): boolean {
  return url.endsWith('/auth/login') || url.endsWith('/auth/password-reset-requests');
}
