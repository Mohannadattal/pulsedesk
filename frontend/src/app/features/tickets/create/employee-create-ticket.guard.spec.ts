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

  it.each([UserRole.EMPLOYEE, UserRole.ADMIN])(
    'allows %s to open the ticket creation page',
    (role) => {
      session.currentUser.mockReturnValue({ role });

      const result = TestBed.runInInjectionContext(() =>
        employeeCreateTicketGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      );

      expect(result).toBe(true);
    },
  );

  it.each([UserRole.AGENT])('keeps %s out of the ticket creation page', (role) => {
    session.currentUser.mockReturnValue({ role });

    const result = TestBed.runInInjectionContext(() =>
      employeeCreateTicketGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(result).toBe(ticketsTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
  });
});
