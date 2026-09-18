import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';

export const employeeCreateTicketGuard: CanActivateFn = () => {
  const session = inject(AuthSessionStore);
  const router = inject(Router);

  return [UserRole.EMPLOYEE, UserRole.ADMIN].includes(session.currentUser()?.role as UserRole)
    ? true
    : router.createUrlTree(['/tickets']);
};
