import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { vi } from 'vitest';

import { UserRole } from '../../api/generated/model/userRole';
import { AuthSessionStore } from '../../platform/auth/auth-session.store';
import { customersGuard } from './customers.guard';

describe('customersGuard', () => {
  const denied = {} as UrlTree;
  const session = { currentUser: vi.fn() };
  const router = { createUrlTree: vi.fn(() => denied) };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
  });

  it.each([UserRole.EMPLOYEE, UserRole.ADMIN])('allows %s into Customer routes', (role) => {
    session.currentUser.mockReturnValue({ role });
    const result = TestBed.runInInjectionContext(() =>
      customersGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(result).toBe(true);
  });

  it('redirects Agents without loading a Customer route', () => {
    session.currentUser.mockReturnValue({ role: UserRole.AGENT });
    const result = TestBed.runInInjectionContext(() =>
      customersGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(result).toBe(denied);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
  });
});
