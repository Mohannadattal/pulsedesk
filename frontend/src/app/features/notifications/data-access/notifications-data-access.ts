import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';

import { NotificationsApi } from '../../../api/generated/api/notifications.service';
import { normalizeHttpError } from '../../../platform/http/app-error';
import { mapNotification, Notification, NotificationPage } from '../domain/notification';

@Injectable({ providedIn: 'root' })
export class NotificationsDataAccess {
  private readonly api = inject(NotificationsApi);

  list(unreadOnly: boolean, page: number, pageSize: number): Observable<NotificationPage> {
    return this.api
      .listNotifications(unreadOnly, page, pageSize, 'body', false, { transferCache: false })
      .pipe(
        map((response) => ({
          items: response.items.map(mapNotification),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
        catchError((error: unknown) => throwError(() => normalizeHttpError(error))),
      );
  }

  unreadCount(): Observable<number> {
    return this.api.getNotificationUnreadCount('body', false, { transferCache: false }).pipe(
      map((response) => response.unread_count),
      catchError((error: unknown) => throwError(() => normalizeHttpError(error))),
    );
  }

  markRead(notificationId: number): Observable<Notification> {
    return this.api
      .markNotificationRead(notificationId, 'body', false, { transferCache: false })
      .pipe(
        map(mapNotification),
        catchError((error: unknown) => throwError(() => normalizeHttpError(error))),
      );
  }

  markAllRead(): Observable<number> {
    return this.api.markAllNotificationsRead('body', false, { transferCache: false }).pipe(
      map((response) => response.updated_count),
      catchError((error: unknown) => throwError(() => normalizeHttpError(error))),
    );
  }
}
