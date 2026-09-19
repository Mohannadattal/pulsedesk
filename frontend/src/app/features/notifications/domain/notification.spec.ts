import { NotificationType } from '../../../api/generated/model/notificationType';
import { UserRole } from '../../../api/generated/model/userRole';
import { mapNotification, notificationTarget } from './notification';

describe('notification presentation', () => {
  it('uses a safe fallback for an unknown runtime type', () => {
    const notification = mapNotification({
      id: 1,
      type: 'FUTURE_TYPE' as NotificationType,
      actor: null,
      ticket: null,
      is_read: false,
      read_at: null,
      created_at: '2026-09-18T09:00:00Z',
    });

    expect(notification.title).toBe('Notification');
  });

  it('derives ticket routes from structured ticket data', () => {
    const notification = mapNotification({
      id: 2,
      type: NotificationType.TICKET_RESOLVED,
      actor: null,
      ticket: { id: 42, ticket_number: 'TKT-ABCDEFGH2345678', title: 'Access request' },
      is_read: true,
      read_at: '2026-09-18T09:01:00Z',
      created_at: '2026-09-18T09:00:00Z',
    });

    expect(notificationTarget(notification, UserRole.EMPLOYEE)).toEqual(['/tickets', 42]);
  });

  it('targets the existing password reset queue only for administrators', () => {
    const notification = mapNotification({
      id: 3,
      type: NotificationType.PASSWORD_RESET_REQUESTED,
      actor: null,
      ticket: null,
      is_read: false,
      read_at: null,
      created_at: '2026-09-18T09:00:00Z',
    });

    expect(notificationTarget(notification, UserRole.ADMIN)).toEqual([
      '/administration/password-resets',
    ]);
    expect(notificationTarget(notification, UserRole.AGENT)).toBeNull();
  });

  it('keeps password-reset-completed informational', () => {
    const notification = mapNotification({
      id: 4,
      type: NotificationType.PASSWORD_RESET_COMPLETED,
      actor: null,
      ticket: null,
      is_read: false,
      read_at: null,
      created_at: '2026-09-18T09:00:00Z',
    });

    expect(notificationTarget(notification, UserRole.ADMIN)).toBeNull();
  });
});
