import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketEventResponse } from '../../../api/generated/model/ticketEventResponse';
import { TicketEventType } from '../../../api/generated/model/ticketEventType';

export type TicketActivityKind =
  | 'created'
  | 'status'
  | 'priority'
  | 'assignment'
  | 'category'
  | 'comment'
  | 'resolved'
  | 'closed'
  | 'unsupported';

export interface TicketActivityItem {
  readonly id: number;
  readonly description: string;
  readonly occurredAt: Date | null;
  readonly kind: TicketActivityKind;
}

export interface TicketActivityPage {
  readonly items: readonly TicketActivityItem[];
  readonly rawPage: number;
  readonly rawPageSize: number;
  readonly rawTotalPages: number;
}

const UNAVAILABLE_USER = 'An unavailable user';
const UNSUPPORTED_DESCRIPTION = 'Unsupported ticket activity.';

const STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const PRIORITY_LABELS: Readonly<Record<string, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export function mapTicketActivity(event: TicketEventResponse): TicketActivityItem | null {
  const actor = nonEmpty(event.actor?.display_name) ?? UNAVAILABLE_USER;
  const occurredAt = validDate(event.created_at);
  const unsupported = (): TicketActivityItem => ({
    id: event.id,
    description: UNSUPPORTED_DESCRIPTION,
    occurredAt,
    kind: 'unsupported',
  });

  switch (event.event_type as string) {
    case TicketEventType.TICKET_CREATED:
      return item(event.id, `${actor} created the ticket.`, occurredAt, 'created');
    case TicketEventType.STATUS_CHANGED: {
      if (event.field_name !== 'status') {
        return unsupported();
      }
      const oldStatus = event.old_value ? STATUS_LABELS[event.old_value] : undefined;
      const newStatus = event.new_value ? STATUS_LABELS[event.new_value] : undefined;
      if (!oldStatus || !newStatus) {
        return unsupported();
      }
      if (event.new_value === 'RESOLVED' || event.new_value === 'CLOSED') {
        return null;
      }
      return item(
        event.id,
        `${actor} changed status from ${oldStatus} to ${newStatus}.`,
        occurredAt,
        'status',
      );
    }
    case TicketEventType.PRIORITY_CHANGED: {
      if (event.field_name !== 'priority') {
        return unsupported();
      }
      const oldPriority = event.old_value ? PRIORITY_LABELS[event.old_value] : undefined;
      const newPriority = event.new_value ? PRIORITY_LABELS[event.new_value] : undefined;
      return oldPriority && newPriority
        ? item(
            event.id,
            `${actor} changed priority from ${oldPriority} to ${newPriority}.`,
            occurredAt,
            'priority',
          )
        : unsupported();
    }
    case TicketEventType.ASSIGNEE_CHANGED: {
      if (event.field_name !== 'assigned_to_id') {
        return unsupported();
      }
      const oldReference = isPositiveId(event.old_value);
      const newReference = isPositiveId(event.new_value);
      const oldAssignee = nonEmpty(event.old_display_value);
      const newAssignee = nonEmpty(event.new_display_value);
      if (
        event.old_value === null &&
        event.old_display_value === null &&
        newReference &&
        newAssignee
      ) {
        return item(
          event.id,
          `${actor} assigned the ticket to ${newAssignee}.`,
          occurredAt,
          'assignment',
        );
      }
      if (oldReference && oldAssignee && newReference && newAssignee) {
        return item(
          event.id,
          `${actor} reassigned the ticket from ${oldAssignee} to ${newAssignee}.`,
          occurredAt,
          'assignment',
        );
      }
      if (
        oldReference &&
        oldAssignee &&
        event.new_value === null &&
        event.new_display_value === null
      ) {
        return item(event.id, `${actor} unassigned the ticket.`, occurredAt, 'assignment');
      }
      return unsupported();
    }
    case TicketEventType.CATEGORY_CHANGED: {
      if (
        event.field_name !== 'category_id' ||
        !isPositiveId(event.old_value) ||
        !isPositiveId(event.new_value)
      ) {
        return unsupported();
      }
      const oldCategory = nonEmpty(event.old_display_value);
      const newCategory = nonEmpty(event.new_display_value);
      if (!oldCategory || !newCategory) {
        return unsupported();
      }
      return item(
        event.id,
        `${actor} changed category from ${oldCategory} to ${newCategory}.`,
        occurredAt,
        'category',
      );
    }
    case TicketEventType.COMMENT_ADDED:
      if (
        isPositiveInteger(event.comment?.id) &&
        event.comment?.visibility === CommentVisibility.PUBLIC
      ) {
        return item(event.id, `${actor} added a public comment.`, occurredAt, 'comment');
      }
      if (
        isPositiveInteger(event.comment?.id) &&
        event.comment?.visibility === CommentVisibility.INTERNAL
      ) {
        return item(event.id, `${actor} added an internal comment.`, occurredAt, 'comment');
      }
      return unsupported();
    case TicketEventType.TICKET_RESOLVED:
      return item(event.id, `${actor} resolved the ticket.`, occurredAt, 'resolved');
    case TicketEventType.TICKET_CLOSED:
      return item(event.id, `${actor} closed the ticket.`, occurredAt, 'closed');
    default:
      return unsupported();
  }
}

function item(
  id: number,
  description: string,
  occurredAt: Date | null,
  kind: TicketActivityKind,
): TicketActivityItem {
  return { id, description, occurredAt, kind };
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isPositiveId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
