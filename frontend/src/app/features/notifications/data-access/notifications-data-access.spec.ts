import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { NotificationsApi } from '../../../api/generated/api/notifications.service';
import { NotificationType } from '../../../api/generated/model/notificationType';
import { NotificationsDataAccess } from './notifications-data-access';

const RESPONSE = {
  id: 17,
  type: NotificationType.TICKET_ASSIGNED,
  actor: { id: 2, first_name: 'Alex', last_name: 'Agent' },
  ticket: { id: 31, ticket_number: 'TKT-ABCDEFGH2345678', title: 'Printer offline' },
  is_read: false,
  read_at: null,
  created_at: '2026-09-18T09:00:00Z',
};

describe('NotificationsDataAccess', () => {
  const api = {
    listNotifications: vi.fn(),
    getNotificationUnreadCount: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [NotificationsDataAccess, { provide: NotificationsApi, useValue: api }],
    });
  });

  it('lists notifications with the unread filter and server pagination', async () => {
    api.listNotifications.mockReturnValue(
      of({ items: [RESPONSE], page: 3, page_size: 10, total: 21, total_pages: 3 }),
    );

    const page = await firstValueFrom(TestBed.inject(NotificationsDataAccess).list(true, 3, 10));

    expect(api.listNotifications).toHaveBeenCalledWith(true, 3, 10, 'body', false, {
      transferCache: false,
    });
    expect(page).toMatchObject({ page: 3, pageSize: 10, total: 21, totalPages: 3 });
    expect(page.items[0]).toMatchObject({
      id: 17,
      title: 'Ticket assigned to you',
      actorName: 'Alex Agent',
      ticket: { id: 31, number: 'TKT-ABCDEFGH2345678', title: 'Printer offline' },
      isRead: false,
    });
  });

  it('loads the lightweight unread count', async () => {
    api.getNotificationUnreadCount.mockReturnValue(of({ unread_count: 8 }));

    await expect(
      firstValueFrom(TestBed.inject(NotificationsDataAccess).unreadCount()),
    ).resolves.toBe(8);
    expect(api.getNotificationUnreadCount).toHaveBeenCalledWith('body', false, {
      transferCache: false,
    });
  });

  it('marks one notification read through the generated client', async () => {
    api.markNotificationRead.mockReturnValue(
      of({ ...RESPONSE, is_read: true, read_at: '2026-09-18T09:01:00Z' }),
    );

    const result = await firstValueFrom(TestBed.inject(NotificationsDataAccess).markRead(17));

    expect(api.markNotificationRead).toHaveBeenCalledWith(17, 'body', false, {
      transferCache: false,
    });
    expect(result.isRead).toBe(true);
  });

  it('marks all read with one generated-client request', async () => {
    api.markAllNotificationsRead.mockReturnValue(of({ updated_count: 4 }));

    await expect(
      firstValueFrom(TestBed.inject(NotificationsDataAccess).markAllRead()),
    ).resolves.toBe(4);
    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it('normalizes transport failures', async () => {
    api.listNotifications.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await expect(
      firstValueFrom(TestBed.inject(NotificationsDataAccess).list(false, 1, 20)),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
  });
});
