import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, map } from 'rxjs';

import { AuthSessionStore } from './auth-session.store';
import { safeLocalReturnUrl } from './return-url';
import { UserRole } from '../../api/generated/model/userRole';

export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return from(session.restore()).pipe(
    map(() =>
      session.isAuthenticated()
        ? true
        : router.createUrlTree(['/sign-in'], {
            queryParams: { returnUrl: safeLocalReturnUrl(state.url) },
          }),
    ),
  );
};

export const anonymousOnlyGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return from(session.restore()).pipe(
    map(() => (session.isAuthenticated() ? router.createUrlTree(['/tickets']) : true)),
  );
};

export const adminGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return from(session.restore()).pipe(
    map(() =>
      session.currentUser()?.role === UserRole.ADMIN ? true : router.createUrlTree(['/tickets']),
    ),
  );
};
