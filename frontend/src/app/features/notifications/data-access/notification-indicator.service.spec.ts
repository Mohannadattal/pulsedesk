import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionState, AuthSessionStore } from '../../../platform/auth/auth-session.store';
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  NotificationIndicatorService,
} from './notification-indicator.service';
import { NotificationsDataAccess } from './notifications-data-access';

const USER = {
  id: 7,
  email: 'agent@example.com',
  first_name: 'Alex',
  last_name: 'Agent',
  role: UserRole.AGENT,
  is_active: true,
  created_at: '2026-09-18T09:00:00Z',
  updated_at: '2026-09-18T09:00:00Z',
};

describe('NotificationIndicatorService', () => {
  const sessionState = signal<AuthSessionState>({ status: 'authenticated', user: USER });
  const session = {
    state: sessionState.asReadonly(),
    hasNormalSession: () => sessionState().status === 'authenticated',
  };
  const dataAccess = { unreadCount: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionState.set({ status: 'authenticated', user: USER });
    dataAccess.unreadCount.mockReturnValue(of(3));
    TestBed.configureTestingModule({
      providers: [
        NotificationIndicatorService,
        { provide: AuthSessionStore, useValue: session },
        { provide: NotificationsDataAccess, useValue: dataAccess },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('loads immediately and polls every 60 seconds without creating a duplicate poller', async () => {
    const service = TestBed.inject(NotificationIndicatorService);

    service.start();
    service.start();
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);

    expect(service.unreadCount()).toBe(3);
    expect(dataAccess.unreadCount).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(dataAccess.unreadCount).toHaveBeenCalledTimes(2);
  });

  it('retains the previous count on failure and reconciles on a later success', async () => {
    dataAccess.unreadCount
      .mockReturnValueOnce(of(4))
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(9));
    const service = TestBed.inject(NotificationIndicatorService);
    service.start();
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.unreadCount()).toBe(4);

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(service.unreadCount()).toBe(4);

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(service.unreadCount()).toBe(9);
  });

  it('cancels a stale poll when reconciling a confirmed read', async () => {
    const stalePoll = new Subject<number>();
    dataAccess.unreadCount
      .mockReturnValueOnce(of(2))
      .mockReturnValueOnce(stalePoll)
      .mockReturnValueOnce(of(1));
    const service = TestBed.inject(NotificationIndicatorService);
    service.start();
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    service.noteOneRead();
    service.refresh();
    expect(service.unreadCount()).toBe(1);

    stalePoll.next(2);
    expect(service.unreadCount()).toBe(1);
    expect(dataAccess.unreadCount).toHaveBeenCalledTimes(3);
  });

  it('clears state and cancels polling at the authentication boundary', async () => {
    const service = TestBed.inject(NotificationIndicatorService);
    service.start();
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.unreadCount()).toBe(3);

    sessionState.set({ status: 'anonymous' });
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.unreadCount()).toBeNull();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS * 2);
    expect(dataAccess.unreadCount).toHaveBeenCalledTimes(1);
  });

  it('clamps optimistic changes and stops its owned lifecycle', async () => {
    dataAccess.unreadCount.mockReturnValue(of(1));
    const service = TestBed.inject(NotificationIndicatorService);
    service.start();
    TestBed.flushEffects();
    await vi.advanceTimersByTimeAsync(0);

    service.noteOneRead();
    service.noteOneRead();
    expect(service.unreadCount()).toBe(0);

    service.stop();
    expect(service.unreadCount()).toBeNull();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(dataAccess.unreadCount).toHaveBeenCalledTimes(1);
  });
});
