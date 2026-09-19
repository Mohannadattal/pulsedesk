import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NotificationType } from '../../../api/generated/model/notificationType';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { NotificationIndicatorService } from '../data-access/notification-indicator.service';
import { NotificationsDataAccess } from '../data-access/notifications-data-access';
import { Notification, NotificationPage } from '../domain/notification';
import { NotificationPreviewComponent } from './notification-preview.component';

const COMMENT_NOTIFICATION: Notification = {
  id: 12,
  type: NotificationType.TICKET_PUBLIC_COMMENT,
  title: 'New public comment on a ticket',
  actorName: 'Emma Employee',
  createdAt: new Date('2026-09-18T09:00:00Z'),
  isRead: false,
  readAt: null,
  ticket: { id: 44, number: 'TKT-ABCDEFGH2345678', title: 'Email setup' },
};

const PAGE: NotificationPage = {
  items: [COMMENT_NOTIFICATION],
  page: 1,
  pageSize: 5,
  total: 1,
  totalPages: 1,
};

const READ_NOTIFICATION: Notification = {
  ...COMMENT_NOTIFICATION,
  id: 13,
  title: 'Previously read notification',
  isRead: true,
  readAt: new Date('2026-09-18T09:05:00Z'),
};

const UNBREAKABLE_VALUE = 'UNBREAKABLE'.repeat(30);

describe('NotificationPreviewComponent', () => {
  let fixture: ComponentFixture<NotificationPreviewComponent>;
  const unreadCount = signal<number | null>(1);
  const session = { currentUser: signal({ role: UserRole.AGENT }) };
  const indicator = {
    unreadCount,
    noteOneRead: vi.fn(() => unreadCount.update((count) => Math.max(0, (count ?? 0) - 1))),
    noteAllRead: vi.fn(() => unreadCount.set(0)),
    refresh: vi.fn(),
  };
  const dataAccess = {
    list: vi.fn(() => of(PAGE)),
    markRead: vi.fn<(notificationId: number) => Observable<Notification>>(() =>
      of({ ...COMMENT_NOTIFICATION, isRead: true, readAt: new Date() }),
    ),
    markAllRead: vi.fn(() => of(1)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    unreadCount.set(1);
    await TestBed.configureTestingModule({
      imports: [NotificationPreviewComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionStore, useValue: session },
        { provide: NotificationIndicatorService, useValue: indicator },
        { provide: NotificationsDataAccess, useValue: dataAccess },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationPreviewComponent);
  });

  it('loads only the newest five unread notifications and renders safe narrow context', () => {
    fixture.componentInstance.load();
    fixture.detectChanges();

    expect(dataAccess.list).toHaveBeenCalledWith(true, 1, 5);
    expect(fixture.nativeElement.textContent).toContain('New public comment on a ticket');
    expect(fixture.nativeElement.textContent).toContain('TKT-ABCDEFGH2345678');
    expect(fixture.nativeElement.textContent).toContain('Email setup');
    expect(fixture.nativeElement.textContent).toContain('Comment from Emma Employee');
    expect(fixture.nativeElement.textContent).not.toContain('customer@example.com');
    expect(fixture.nativeElement.textContent).not.toContain('comment body');
    expect(fixture.nativeElement.querySelector('.notification--unread')).not.toBeNull();
  });

  it('keeps the scrolling preview and compact row content width-safe', () => {
    dataAccess.list.mockReturnValueOnce(
      of({
        ...PAGE,
        items: [
          {
            ...COMMENT_NOTIFICATION,
            title: UNBREAKABLE_VALUE,
            actorName: UNBREAKABLE_VALUE,
            ticket: {
              ...COMMENT_NOTIFICATION.ticket!,
              number: UNBREAKABLE_VALUE,
              title: UNBREAKABLE_VALUE,
            },
          },
        ],
      }),
    );

    fixture.componentInstance.load();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.preview') as HTMLElement;
    const action = fixture.nativeElement.querySelector('.notification__action') as HTMLElement;
    const heading = fixture.nativeElement.querySelector(
      '.notification__heading strong',
    ) as HTMLElement;
    const ticketNumber = fixture.nativeElement.querySelector(
      '.notification__ticket-number',
    ) as HTMLElement;
    const ticketTitle = fixture.nativeElement.querySelector(
      '.notification__ticket-title',
    ) as HTMLElement;
    const actor = fixture.nativeElement.querySelector('.notification__actor') as HTMLElement;

    expect(getComputedStyle(preview).width).toBe('100%');
    expect(getComputedStyle(preview).overflow).toBe('auto');
    expect(getComputedStyle(action).minWidth).toBe('0');
    expect(getComputedStyle(heading).whiteSpace).toBe('normal');
    expect(getComputedStyle(ticketNumber).minWidth).toBe('0');
    expect(getComputedStyle(ticketNumber).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(ticketTitle).whiteSpace).toBe('normal');
    expect(getComputedStyle(actor).overflowWrap).toBe('anywhere');
  });

  it('defensively excludes already-read notifications from the bell dropdown', () => {
    dataAccess.list.mockReturnValueOnce(
      of({ ...PAGE, items: [COMMENT_NOTIFICATION, READ_NOTIFICATION], total: 2 }),
    );

    fixture.componentInstance.load();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.notification__action')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).not.toContain(READ_NOTIFICATION.title);
  });

  it('marks one read, then removes it and updates the badge after success', () => {
    const markReadResult = new Subject<Notification>();
    dataAccess.markRead.mockReturnValueOnce(markReadResult);
    const navigated = vi.fn();
    fixture.componentInstance.navigate.subscribe(navigated);
    fixture.componentInstance.load();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.notification__action').click();
    fixture.detectChanges();

    expect(dataAccess.markRead).toHaveBeenCalledWith(12);
    expect(navigated).toHaveBeenCalledWith(COMMENT_NOTIFICATION);
    expect(indicator.noteOneRead).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.notification--unread')).not.toBeNull();

    markReadResult.next({ ...COMMENT_NOTIFICATION, isRead: true, readAt: new Date() });
    markReadResult.complete();
    fixture.detectChanges();

    expect(indicator.noteOneRead).toHaveBeenCalledOnce();
    expect(indicator.refresh).toHaveBeenCalledOnce();
    expect(unreadCount()).toBe(0);
    expect(fixture.nativeElement.querySelector('.notification__action')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });

  it('keeps the notification and badge unchanged when marking read fails', () => {
    dataAccess.markRead.mockReturnValueOnce(throwError(() => new Error('offline')));
    fixture.componentInstance.load();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.notification__action').click();
    fixture.detectChanges();

    expect(indicator.noteOneRead).not.toHaveBeenCalled();
    expect(indicator.refresh).not.toHaveBeenCalled();
    expect(unreadCount()).toBe(1);
    expect(fixture.nativeElement.querySelector('.notification--unread')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'The notification could not be marked read.',
    );
  });

  it('does not resurrect a confirmed-read notification from a stale refresh', () => {
    fixture.componentInstance.load();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.notification__action').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.notification__action')).toBeNull();

    dataAccess.list.mockReturnValueOnce(of(PAGE));
    fixture.componentInstance.load();
    fixture.detectChanges();

    expect(dataAccess.list).toHaveBeenLastCalledWith(true, 1, 5);
    expect(fixture.nativeElement.querySelector('.notification__action')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });

  it('marks all read with one request, empties the dropdown, and clears the badge', () => {
    fixture.componentInstance.load();
    fixture.detectChanges();

    const markAll = [...fixture.nativeElement.querySelectorAll('button')].find((button: Element) =>
      button.textContent?.includes('Mark all read'),
    ) as HTMLButtonElement;
    markAll.click();
    fixture.detectChanges();

    expect(dataAccess.markAllRead).toHaveBeenCalledOnce();
    expect(indicator.noteAllRead).toHaveBeenCalledOnce();
    expect(unreadCount()).toBe(0);
    expect(fixture.nativeElement.querySelector('.notification__action')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });

  it('shows a restrained empty state', () => {
    dataAccess.list.mockReturnValueOnce(of({ ...PAGE, items: [], total: 0, totalPages: 0 }));
    fixture.componentInstance.load();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("You're all caught up.");
  });
});
