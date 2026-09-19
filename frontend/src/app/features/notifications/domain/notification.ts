import { NotificationResponse } from '../../../api/generated/model/notificationResponse';
import { NotificationType } from '../../../api/generated/model/notificationType';
import { UserRole } from '../../../api/generated/model/userRole';

export interface Notification {
  readonly id: number;
  readonly type: NotificationType | string;
  readonly title: string;
  readonly actorName: string | null;
  readonly createdAt: Date;
  readonly isRead: boolean;
  readonly readAt: Date | null;
  readonly ticket: {
    readonly id: number;
    readonly number: string;
    readonly title: string;
  } | null;
}

export interface NotificationPage {
  readonly items: readonly Notification[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

const TITLES: Readonly<Record<NotificationType, string>> = {
  [NotificationType.TICKET_ASSIGNED]: 'Ticket assigned to you',
  [NotificationType.TICKET_REASSIGNED]: 'Ticket reassigned to you',
  [NotificationType.TICKET_PUBLIC_COMMENT]: 'New public comment on a ticket',
  [NotificationType.TICKET_IN_PROGRESS]: 'Ticket is now in progress',
  [NotificationType.TICKET_RESOLVED]: 'Ticket resolved',
  [NotificationType.TICKET_CLOSED]: 'Ticket closed',
  [NotificationType.PASSWORD_RESET_REQUESTED]: 'Password reset requested',
  [NotificationType.PASSWORD_RESET_COMPLETED]: 'Your password was reset',
};

export function mapNotification(response: NotificationResponse): Notification {
  const runtimeType = response.type as string;
  return {
    id: response.id,
    type: runtimeType,
    title: TITLES[runtimeType as NotificationType] ?? 'Notification',
    actorName: response.actor
      ? `${response.actor.first_name} ${response.actor.last_name}`.trim()
      : null,
    createdAt: new Date(response.created_at),
    isRead: response.is_read,
    readAt: response.read_at ? new Date(response.read_at) : null,
    ticket: response.ticket
      ? {
          id: response.ticket.id,
          number: response.ticket.ticket_number,
          title: response.ticket.title,
        }
      : null,
  };
}

export function notificationTarget(
  notification: Notification,
  role: UserRole | undefined,
): readonly (string | number)[] | null {
  if (notification.ticket) return ['/tickets', notification.ticket.id];
  if (notification.type === NotificationType.PASSWORD_RESET_REQUESTED && role === UserRole.ADMIN) {
    return ['/administration/password-resets'];
  }
  return null;
}

export function notificationActorLabel(notification: Notification): string | null {
  if (!notification.actorName) return null;
  if (notification.type === NotificationType.TICKET_PUBLIC_COMMENT) {
    return `Comment from ${notification.actorName}`;
  }
  if (
    notification.type === NotificationType.TICKET_ASSIGNED ||
    notification.type === NotificationType.TICKET_REASSIGNED
  ) {
    return `Assigned by ${notification.actorName}`;
  }
  return null;
}

export function withReadState(notification: Notification, isRead: boolean): Notification {
  return {
    ...notification,
    isRead,
    readAt: isRead ? (notification.readAt ?? new Date()) : null,
  };
}
