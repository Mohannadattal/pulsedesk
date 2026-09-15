import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';

export const employeeCreateTicketGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return session.currentUser()?.role === UserRole.EMPLOYEE
    ? true
    : router.createUrlTree(['/tickets']);
};
