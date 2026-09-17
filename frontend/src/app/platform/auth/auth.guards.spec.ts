import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { vi } from 'vitest';

import { AuthSessionStore } from './auth-session.store';
import { UserRole } from '../../api/generated/model/userRole';
import { adminGuard, anonymousOnlyGuard, authGuard, passwordChangeGuard } from './auth.guards';

describe('auth guards', () => {
  const session = {
    restore: vi.fn().mockResolvedValue(undefined),
    hasNormalSession: vi.fn(),
    requiresPasswordChange: vi.fn(),
    currentUser: vi.fn(),
  };
  const signInTree = {} as UrlTree;
  const ticketsTree = {} as UrlTree;
  const setPasswordTree = {} as UrlTree;
  const router = {
    createUrlTree: vi.fn((commands: readonly string[]) => {
      if (commands[0] === '/sign-in') return signInTree;
      if (commands[0] === '/set-password') return setPasswordTree;
      return ticketsTree;
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    session.hasNormalSession.mockReturnValue(false);
    session.requiresPasswordChange.mockReturnValue(false);
    session.currentUser.mockReturnValue(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionStore, useValue: session },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('redirects an anonymous user and preserves a safe local return URL', async () => {
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
    session.hasNormalSession.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      anonymousOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    const resolved = await firstValueFrom(result as Observable<boolean | UrlTree>);

    expect(resolved).toBe(ticketsTree);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/tickets']);
  });

  it('redirects a restricted session away from sign-in and the shell', async () => {
    session.requiresPasswordChange.mockReturnValue(true);

    const signInResult = TestBed.runInInjectionContext(() =>
      anonymousOnlyGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    const shellResult = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/tickets' } as RouterStateSnapshot),
    );

    expect(await firstValueFrom(signInResult as Observable<boolean | UrlTree>)).toBe(
      setPasswordTree,
    );
    expect(await firstValueFrom(shellResult as Observable<boolean | UrlTree>)).toBe(
      setPasswordTree,
    );
  });

  it('allows only a restricted session onto set-password', async () => {
    session.requiresPasswordChange.mockReturnValue(true);
    let result = TestBed.runInInjectionContext(() =>
      passwordChangeGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(true);

    session.requiresPasswordChange.mockReturnValue(false);
    result = TestBed.runInInjectionContext(() =>
      passwordChangeGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(signInTree);

    session.hasNormalSession.mockReturnValue(true);
    result = TestBed.runInInjectionContext(() =>
      passwordChangeGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
    expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(ticketsTree);
  });

  it('waits for restoration before deciding, avoiding a restoring redirect loop', async () => {
    let finishRestore: (() => void) | undefined;
    session.restore.mockReturnValueOnce(new Promise<void>((resolve) => (finishRestore = resolve)));
    session.requiresPasswordChange.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/tickets' } as RouterStateSnapshot),
    );
    let settled = false;
    firstValueFrom(result as Observable<boolean | UrlTree>).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    finishRestore?.();
    expect(await firstValueFrom(result as Observable<boolean | UrlTree>)).toBe(setPasswordTree);
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
