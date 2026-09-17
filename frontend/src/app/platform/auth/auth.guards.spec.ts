import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionStore } from './auth-session.store';
import { UserRole } from '../../api/generated/model/userRole';
import { adminGuard, anonymousOnlyGuard, authGuard } from './auth.guards';

describe('auth guards', () => {
  const session = {
    restore: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: vi.fn(),
    currentUser: vi.fn(),
  };
  const signInTree = {} as UrlTree;
  const ticketsTree = {} as UrlTree;
  const router = {
    createUrlTree: vi.fn((commands: readonly string[]) =>
      commands[0] === '/sign-in' ? signInTree : ticketsTree,
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('redirects an anonymous user and preserves a safe local return URL', async () => {
    session.isAuthenticated.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() =>
      authGuard(
        {} as ActivatedRouteSnapshot,
        { url: '/tickets?status=OPEN' } as RouterStateSnapshot,
      ),
    );
    const resolved = await firstValueFrom(result as Observable<boolean | UrlTree>);

    expect(resolved).toBe(signInTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/sign-in'], {
      queryParams: { returnUrl: '/tickets?status=OPEN' },
    });
  });

  it('redirects an authenticated user away from sign-in', async () => {
    session.isAuthenticated.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      anonymousOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    const resolved = await firstValueFrom(result as Observable<boolean | UrlTree>);

    expect(resolved).toBe(ticketsTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
  });

  it('allows an administrator into Administration', async () => {
    session.currentUser.mockReturnValue({ role: UserRole.ADMIN });

    const result = TestBed.runInInjectionContext(() =>
      adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(true);
    expect(session.restore).toHaveBeenCalledOnce();
  });

  it.each([UserRole.EMPLOYEE, UserRole.AGENT])(
    'redirects %s away from Administration before feature activation',
    async (role) => {
      session.currentUser.mockReturnValue({ role });

      const result = TestBed.runInInjectionContext(() =>
        adminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
      );

      expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(ticketsTree);
      expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
    },
  );
});
