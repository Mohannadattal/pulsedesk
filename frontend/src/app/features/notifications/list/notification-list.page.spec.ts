import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NotificationType } from '../../../api/generated/model/notificationType';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { AppError } from '../../../platform/http/app-error';
import { NotificationIndicatorService } from '../data-access/notification-indicator.service';
import { NotificationsDataAccess } from '../data-access/notifications-data-access';
import { Notification, NotificationPage } from '../domain/notification';
import { NotificationListPage } from './notification-list.page';

const TICKET_NOTIFICATION: Notification = {
  id: 8,
  type: NotificationType.TICKET_ASSIGNED,
  title: 'Ticket assigned to you',
  actorName: 'Amir Admin',
  createdAt: new Date('2026-09-18T09:00:00Z'),
  isRead: false,
  readAt: null,
  ticket: { id: 42, number: 'TKT-ABCDEFGH2345678', title: 'Printer offline' },
};

const PAGE: NotificationPage = {
  items: [TICKET_NOTIFICATION],
  page: 1,
  pageSize: 20,
  total: 21,
  totalPages: 2,
};

describe('NotificationListPage', () => {
  let fixture: ComponentFixture<NotificationListPage>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  const session = { currentUser: vi.fn(() => ({ role: UserRole.AGENT })) };
  const indicator = {
    unreadCount: vi.fn(() => 2),
    noteOneRead: vi.fn(),
    noteAllRead: vi.fn(),
    refresh: vi.fn(),
  };
  const dataAccess = {
    list: vi.fn<() => Observable<NotificationPage>>(),
    markRead: vi.fn(() => of({ ...TICKET_NOTIFICATION, isRead: true, readAt: new Date() })),
    markAllRead: vi.fn(() => of(2)),
  };

  async function render(query: Record<string, string> = {}, page = PAGE): Promise<void> {
    params = new BehaviorSubject(convertToParamMap(query));
    dataAccess.list.mockReturnValue(of(page));
    await TestBed.configureTestingModule({
      imports: [NotificationListPage],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: router },
        { provide: AuthSessionStore, useValue: session },
        { provide: NotificationIndicatorService, useValue: indicator },
        { provide: NotificationsDataAccess, useValue: dataAccess },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationListPage);
    fixture.detectChanges();
  }

  beforeEach(() => vi.clearAllMocks());

  it('renders the server page and uses its pagination metadata', async () => {
    await render();

    expect(dataAccess.list).toHaveBeenCalledWith(false, 1, 20);
    expect(fixture.nativeElement.textContent).toContain('Ticket assigned to you');
    expect(fixture.nativeElement.textContent).toContain('21 notifications');
    expect(fixture.nativeElement.querySelector('mat-paginator')).not.toBeNull();
  });

  it('requests unread-only on the server and renders its empty state', async () => {
    await render(
      { filter: 'unread' },
      { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
    );

    expect(dataAccess.list).toHaveBeenCalledWith(true, 1, 20);
    expect(fixture.nativeElement.textContent).toContain('No unread notifications.');
  });

  it('keeps a read notification in All and excludes it from Unread', async () => {
    const readNotification: Notification = {
      ...TICKET_NOTIFICATION,
      isRead: true,
      readAt: new Date('2026-09-18T09:05:00Z'),
    };
    await render({}, { ...PAGE, items: [readNotification], total: 1, totalPages: 1 });

    expect(fixture.nativeElement.textContent).toContain('Ticket assigned to you');
    expect(dataAccess.list).toHaveBeenLastCalledWith(false, 1, 20);

    dataAccess.list.mockReturnValueOnce(
      of({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 }),
    );
    params.next(convertToParamMap({ filter: 'unread' }));
    fixture.detectChanges();

    expect(dataAccess.list).toHaveBeenLastCalledWith(true, 1, 20);
    expect(fixture.nativeElement.textContent).not.toContain('Ticket assigned to you');
    expect(fixture.nativeElement.textContent).toContain('No unread notifications.');
  });

  it('resets pagination when the filter changes', async () => {
    await render({ page: '4' });

    fixture.componentInstance['setFilter']('unread');

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { filter: 'unread', page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('preserves the filter during server pagination', async () => {
    await render({ filter: 'unread' });

    fixture.componentInstance['changePage']({ pageIndex: 1, pageSize: 20, length: 21 });

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: TestBed.inject(ActivatedRoute),
      queryParams: { page: 2, pageSize: 20 },
      queryParamsHandling: 'merge',
    });
  });

  it('cancels a stale list request when query state changes', async () => {
    const first = new Subject<NotificationPage>();
    dataAccess.list.mockReturnValueOnce(first).mockReturnValueOnce(of(PAGE));
    await render();

    params.next(convertToParamMap({ filter: 'unread' }));
    first.next({ ...PAGE, items: [], total: 0 });
    fixture.detectChanges();

    expect(dataAccess.list).toHaveBeenLastCalledWith(true, 1, 20);
    expect(fixture.nativeElement.textContent).toContain('Ticket assigned to you');
  });

  it('marks one read and navigates to the structured ticket target immediately', async () => {
    await render();

    fixture.nativeElement.querySelector('.notification__action').click();
    fixture.detectChanges();

    expect(dataAccess.markRead).toHaveBeenCalledWith(8);
    expect(indicator.noteOneRead).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/tickets', 42]);
  });

  it('marks all read with one request', async () => {
    await render();

    fixture.componentInstance['markAllRead']();

    expect(dataAccess.markAllRead).toHaveBeenCalledOnce();
    expect(indicator.noteAllRead).toHaveBeenCalledOnce();
    expect(dataAccess.markRead).not.toHaveBeenCalled();
  });

  it('marks an informational notification read without navigating', async () => {
    const informational: Notification = {
      ...TICKET_NOTIFICATION,
      id: 19,
      type: NotificationType.PASSWORD_RESET_COMPLETED,
      title: 'Your password was reset',
      ticket: null,
    };
    await render({}, { ...PAGE, items: [informational], total: 1, totalPages: 1 });

    fixture.nativeElement.querySelector('.notification__action').click();

    expect(dataAccess.markRead).toHaveBeenCalledWith(19);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows the all-notifications empty state', async () => {
    await render({}, { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });

    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });

  it('renders a normalized API failure state', async () => {
    params = new BehaviorSubject(convertToParamMap({}));
    dataAccess.list.mockReturnValue(throwError(() => new AppError('unavailable')));
    await TestBed.configureTestingModule({
      imports: [NotificationListPage],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: router },
        { provide: AuthSessionStore, useValue: session },
        { provide: NotificationIndicatorService, useValue: indicator },
        { provide: NotificationsDataAccess, useValue: dataAccess },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationListPage);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Notifications are temporarily unavailable',
    );
  });
});
