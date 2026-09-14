import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { BASE_PATH } from './api/generated/variables';
import { AuthSessionStore } from './platform/auth/auth-session.store';
import {
  apiTransportBasePath,
  PULSE_DESK_CONFIG,
  pulseDeskConfig,
} from './platform/config/app-config';
import { authInterceptor } from './platform/http/auth.interceptor';
import { errorInterceptor } from './platform/http/error.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    { provide: PULSE_DESK_CONFIG, useValue: pulseDeskConfig },
    {
      provide: BASE_PATH,
      useFactory: () => apiTransportBasePath(inject(PULSE_DESK_CONFIG)),
    },
    provideAppInitializer(() => inject(AuthSessionStore).restore()),
  ],
};
