import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { employeeCreateTicketGuard } from './employee-create-ticket.guard';

describe('employeeCreateTicketGuard', () => {
  const ticketsTree = {} as UrlTree;
  const session = { currentUser: vi.fn() };
  const router = { createUrlTree: vi.fn().mockReturnValue(ticketsTree) };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('allows employees to open the ticket creation page', () => {
    session.currentUser.mockReturnValue({ role: UserRole.EMPLOYEE });

    const result = TestBed.runInInjectionContext(() =>
      employeeCreateTicketGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(result).toBe(true);
  });

  it.each([UserRole.AGENT, UserRole.ADMIN])(
    'keeps %s mutation workflows out of the employee page',
    (role) => {
      session.currentUser.mockReturnValue({ role });

      const result = TestBed.runInInjectionContext(() =>
        employeeCreateTicketGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      );

      expect(result).toBe(ticketsTree);
      expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
    },
  );
});
