import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, Params, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import {
  AdministrationDataAccess,
  AdminUser,
  AdminUserPage,
} from '../data-access/administration-data-access';
import { AdminUserFilters } from '../domain/admin-user-filters';
import { UserListPage } from './user-list.page';

const EMPTY_PAGE: AdminUserPage = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

const AGENT: AdminUser = {
  id: 2,
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Agent',
  role: UserRole.AGENT,
  isActive: true,
  createdAt: new Date('2026-09-17T08:00:00Z'),
  updatedAt: new Date('2026-09-17T08:00:00Z'),
};

const ADMIN: AdminUser = {
  ...AGENT,
  id: 7,
  email: 'admin@example.com',
  firstName: 'Amir',
  lastName: 'Admin',
  role: UserRole.ADMIN,
};

function page(items: readonly AdminUser[], pageNumber = 1, total = items.length): AdminUserPage {
  return {
    items,
    page: pageNumber,
    pageSize: 20,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / 20),
  };
}

describe('UserListPage URL state and requests', () => {
  let fixture: ComponentFixture<UserListPage>;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let route: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: Observable<ReturnType<typeof convertToParamMap>>;
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  const administration = {
    listUsers: vi.fn<(_filters: AdminUserFilters) => Observable<AdminUserPage>>(),
    updateUserActivation: vi.fn(),
  };
  const session = { currentUser: vi.fn(() => ({ id: 1, role: UserRole.ADMIN })) };
  const dialog = { open: vi.fn() };

  async function render(
    query: Params = {},
    configureRequest?: () => void,
    withTemplate = false,
  ): Promise<void> {
    const initial = convertToParamMap(query);
    queryParams = new BehaviorSubject(initial);
    route = { snapshot: { queryParamMap: initial }, queryParamMap: queryParams };
    if (configureRequest) configureRequest();
    const testModule = TestBed.configureTestingModule({
      imports: [UserListPage],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: AuthSessionStore, useValue: session },
        { provide: AdministrationDataAccess, useValue: administration },
        { provide: MatDialog, useValue: dialog },
      ],
    }).overrideProvider(MatDialog, { useValue: dialog });
    if (!withTemplate) testModule.overrideComponent(UserListPage, { set: { template: '' } });
    await testModule.compileComponents();
    fixture = TestBed.createComponent(UserListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    administration.listUsers.mockReset();
    administration.listUsers.mockReturnValue(of(EMPTY_PAGE));
    session.currentUser.mockReturnValue({ id: 1, role: UserRole.ADMIN });
    administration.updateUserActivation.mockReturnValue(of(AGENT));
  });

  it('canonicalizes invalid and explicit default query parameters', async () => {
    await render({ role: 'OWNER', isActive: 'yes', page: '1', pageSize: '20' });

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { role: null, isActive: null, page: null, pageSize: null },
      replaceUrl: true,
    });
    expect(administration.listUsers).toHaveBeenCalledWith({
      role: undefined,
      isActive: true,
      page: 1,
      pageSize: 20,
    });
  });

  it('resets the page when role or active state changes', async () => {
    await render({ page: '6' });
    router.navigate.mockClear();
    fixture.componentInstance['filterForm'].setValue({ role: UserRole.AGENT, active: 'false' });
    fixture.componentInstance['applyFilters']();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: { role: UserRole.AGENT, isActive: 'false', page: null, pageSize: null },
      replaceUrl: false,
    });
  });

  it('cancels stale responses when URL state changes', async () => {
    const first = new Subject<AdminUserPage>();
    const second = new Subject<AdminUserPage>();
    await render({ role: 'AGENT' }, () =>
      administration.listUsers.mockImplementation((filters) =>
        filters.role === UserRole.AGENT ? first : second,
      ),
    );

    queryParams.next(convertToParamMap({ role: 'ADMIN' }));
    const latest = { ...EMPTY_PAGE, total: 2 };
    second.next(latest);
    first.next({ ...EMPTY_PAGE, total: 99 });

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') expect(state.page.total).toBe(2);
  });

  it('retains confirmed data when a refresh fails', async () => {
    const confirmed = { ...EMPTY_PAGE, total: 3 };
    await render({}, () => administration.listUsers.mockReturnValue(of(confirmed)));
    administration.listUsers.mockReturnValue(throwError(() => new Error('offline')));

    fixture.componentInstance['retry']();

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') {
      expect(state.page.total).toBe(3);
      expect(state.refreshError).toBeDefined();
    }
  });

  it('does not reconcile an Agent mutation into a newer Admin query', async () => {
    const mutation = new Subject<AdminUser>();
    administration.updateUserActivation.mockReturnValue(mutation);
    administration.listUsers.mockImplementation((filters) =>
      of(filters.role === UserRole.ADMIN ? page([ADMIN], 1, 4) : page([AGENT], 1, 6)),
    );
    await render({ role: UserRole.AGENT });

    fixture.componentInstance['changeActivation'](AGENT, false);
    queryParams.next(convertToParamMap({ role: UserRole.ADMIN }));
    mutation.next({ ...AGENT, isActive: false });

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') {
      expect(state.page.items).toEqual([ADMIN]);
      expect(state.page.total).toBe(4);
      expect(state.filters.role).toBe(UserRole.ADMIN);
    }
    expect(administration.listUsers).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['successMessage']()).toContain('deactivated');
    expect(fixture.componentInstance['actionError']()).toBeNull();
  });

  it('does not reconcile a mutation into a newer page', async () => {
    const mutation = new Subject<AdminUser>();
    administration.updateUserActivation.mockReturnValue(mutation);
    administration.listUsers.mockImplementation((filters) =>
      of(filters.page === 2 ? page([ADMIN], 2, 21) : page([AGENT], 1, 21)),
    );
    await render({ role: UserRole.AGENT });

    fixture.componentInstance['changeActivation'](AGENT, false);
    queryParams.next(convertToParamMap({ role: UserRole.AGENT, page: '2' }));
    mutation.next({ ...AGENT, isActive: false });

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') {
      expect(state.page.page).toBe(2);
      expect(state.page.items).toEqual([ADMIN]);
      expect(state.page.total).toBe(21);
    }
  });

  it('reconciles deactivation while the originating query remains current', async () => {
    const mutation = new Subject<AdminUser>();
    const refresh = new Subject<AdminUserPage>();
    administration.updateUserActivation.mockReturnValue(mutation);
    let calls = 0;
    await render({ role: UserRole.AGENT }, () =>
      administration.listUsers.mockImplementation(() =>
        calls++ === 0 ? of(page([AGENT], 1, 3)) : refresh,
      ),
    );

    fixture.componentInstance['changeActivation'](AGENT, false);
    mutation.next({ ...AGENT, isActive: false });

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('refreshing');
    if (state.kind === 'refreshing') {
      expect(state.page.items).toEqual([]);
      expect(state.page.total).toBe(2);
    }
  });

  it('uses role as well as active-state semantics during reconciliation', async () => {
    const refresh = new Subject<AdminUserPage>();
    let calls = 0;
    await render({ role: UserRole.AGENT }, () =>
      administration.listUsers.mockImplementation(() =>
        calls++ === 0 ? of(page([AGENT], 1, 2)) : refresh,
      ),
    );
    administration.updateUserActivation.mockReturnValue(
      of({ ...AGENT, role: UserRole.ADMIN, isActive: true }),
    );

    fixture.componentInstance['changeActivation'](AGENT, true);

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('refreshing');
    if (state.kind === 'refreshing') {
      expect(state.page.items).toEqual([]);
      expect(state.page.total).toBe(1);
    }
  });

  it('keeps a successful mutation and confirmed reconciliation when refresh fails', async () => {
    let calls = 0;
    await render({ role: UserRole.AGENT }, () =>
      administration.listUsers.mockImplementation(() =>
        calls++ === 0 ? of(page([AGENT], 1, 1)) : throwError(() => new Error('offline')),
      ),
    );
    administration.updateUserActivation.mockReturnValue(of({ ...AGENT, isActive: false }));

    fixture.componentInstance['changeActivation'](AGENT, false);

    const state = fixture.componentInstance['state']();
    expect(state.kind).toBe('loaded');
    if (state.kind === 'loaded') {
      expect(state.page.items).toEqual([]);
      expect(state.page.total).toBe(0);
      expect(state.refreshError).toBeDefined();
    }
    expect(fixture.componentInstance['successMessage']()).toContain('deactivated');
    expect(fixture.componentInstance['actionError']()).toBeNull();
  });

  it('confirms deactivation and warns about existing Agent assignments', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    administration.listUsers.mockReturnValue(of(page([AGENT])));
    administration.updateUserActivation.mockReturnValue(of({ ...AGENT, isActive: false }));
    await render({ role: UserRole.AGENT });

    fixture.componentInstance['requestActivationChange'](AGENT);

    expect(dialog.open).toHaveBeenCalledOnce();
    expect(dialog.open.mock.calls[0][1].data).toMatchObject({
      title: 'Deactivate Ada Agent?',
      confirmLabel: 'Deactivate',
    });
    expect(dialog.open.mock.calls[0][1].data.message).toContain(
      'Existing assigned tickets remain assigned',
    );
    expect(administration.updateUserActivation).toHaveBeenCalledWith(AGENT.id, false);
  });

  it('keeps self-deactivation unavailable even if invoked through either presentation', async () => {
    const self = { ...ADMIN, id: 1 };
    session.currentUser.mockReturnValue({ id: 1, role: UserRole.ADMIN });
    await render({}, () => administration.listUsers.mockReturnValue(of(page([self]))));

    fixture.componentInstance['requestActivationChange'](self);
    fixture.componentInstance['requestActivationChange'](self);

    expect(fixture.componentInstance['isSelf'](self)).toBe(true);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(administration.updateUserActivation).not.toHaveBeenCalled();
  });

  it('routes desktop and mobile activation actions through the same guarded path', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(false) });
    await render(
      { role: UserRole.AGENT },
      () => administration.listUsers.mockReturnValue(of(page([AGENT]))),
      true,
    );

    const actionButtons = [...fixture.nativeElement.querySelectorAll('button')].filter(
      (button) => (button as HTMLButtonElement).textContent?.trim() === 'Deactivate',
    ) as HTMLButtonElement[];
    expect(actionButtons).toHaveLength(2);

    actionButtons.forEach((button) => button.click());

    expect(dialog.open).toHaveBeenCalledTimes(2);
    expect(administration.updateUserActivation).not.toHaveBeenCalled();
  });

  it.each([
    ['USER_SELF_DEACTIVATION_FORBIDDEN', 'You cannot deactivate your own administrator account.'],
    ['LAST_ACTIVE_ADMIN_REQUIRED', 'at least one active administrator is required'],
  ])('handles %s contextually', async (code, expected) => {
    await render({}, () => administration.listUsers.mockReturnValue(of(page([ADMIN]))));
    administration.updateUserActivation.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code, detail: 'Conflict' } })),
    );

    fixture.componentInstance['changeActivation'](ADMIN, false);

    expect(fixture.componentInstance['actionError']()).toContain(expected);
    const state = fixture.componentInstance['state']();
    if (state.kind === 'loaded') expect(state.page).toEqual(page([ADMIN]));
  });

  it('reactivates immediately and prevents duplicate mutation submission', async () => {
    const inactive = { ...AGENT, isActive: false };
    const pending = new Subject<AdminUser>();
    administration.updateUserActivation.mockReturnValue(pending);
    await render({ role: UserRole.AGENT, isActive: 'false' }, () =>
      administration.listUsers.mockReturnValue(of(page([inactive]))),
    );

    fixture.componentInstance['requestActivationChange'](inactive);
    fixture.componentInstance['requestActivationChange'](inactive);

    expect(dialog.open).not.toHaveBeenCalled();
    expect(administration.updateUserActivation).toHaveBeenCalledOnce();
    expect(administration.updateUserActivation).toHaveBeenCalledWith(inactive.id, true);
  });

  it('preserves confirmed state on failure and refreshes a stale 404 target', async () => {
    let calls = 0;
    await render({}, () =>
      administration.listUsers.mockImplementation(() => {
        calls += 1;
        return of(page([AGENT]));
      }),
    );
    administration.updateUserActivation.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, error: { code: 'USER_NOT_FOUND' } })),
    );

    fixture.componentInstance['changeActivation'](AGENT, false);

    expect(calls).toBe(2);
    expect(fixture.componentInstance['actionError']()).toContain('no longer exists');
    const state = fixture.componentInstance['state']();
    if (state.kind === 'loaded') expect(state.page).toEqual(page([AGENT]));
  });
});
