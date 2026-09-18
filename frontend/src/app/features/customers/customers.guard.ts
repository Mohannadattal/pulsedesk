import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';

export const customersGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);
  const role = session.currentUser()?.role;
  return role === UserRole.EMPLOYEE || role === UserRole.ADMIN
    ? true
    : router.createUrlTree(['/tickets']);
};
