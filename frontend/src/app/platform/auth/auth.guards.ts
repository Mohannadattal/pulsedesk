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
      session.hasNormalSession()
        ? true
        : session.requiresPasswordChange()
          ? router.createUrlTree(['/set-password'])
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
    map(() =>
      session.hasNormalSession()
        ? router.createUrlTree(['/tickets'])
        : session.requiresPasswordChange()
          ? router.createUrlTree(['/set-password'])
          : true,
    ),
  );
};

export const passwordChangeGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return from(session.restore()).pipe(
    map(() =>
      session.requiresPasswordChange()
        ? true
        : router.createUrlTree([session.hasNormalSession() ? '/tickets' : '/sign-in']),
    ),
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
