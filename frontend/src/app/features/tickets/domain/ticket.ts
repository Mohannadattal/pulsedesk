import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketResponse } from '../../../api/generated/model/ticketResponse';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';

export interface DisplayReference {
  readonly id: number;
  readonly name: string;
}

export interface Ticket {
  readonly id: number;
  readonly ticketNumber: string;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: DisplayReference;
  readonly creator: DisplayReference;
  readonly assignee: DisplayReference | null;
  readonly customer: (DisplayReference & { readonly customerNumber: string }) | null;
  readonly customerWasVerified: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
}

export interface TicketPage {
  readonly items: readonly Ticket[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function mapTicket(dto: TicketResponse): Ticket {
  return {
    id: dto.id,
    ticketNumber: dto.ticket_number,
    title: dto.title,
    description: dto.description,
    status: dto.status,
    priority: dto.priority,
    category: { id: dto.category.id, name: dto.category.name },
    creator: { id: dto.created_by.id, name: personName(dto.created_by) },
    assignee: dto.assigned_to
      ? { id: dto.assigned_to.id, name: personName(dto.assigned_to) }
      : null,
    customer: dto.customer
      ? {
          id: dto.customer.id,
          name: personName(dto.customer),
          customerNumber: dto.customer.customer_number,
        }
      : null,
    customerWasVerified: dto.customer_was_verified,
    createdAt: parseUtcTimestamp(dto.created_at),
    updatedAt: parseUtcTimestamp(dto.updated_at),
    resolvedAt: dto.resolved_at ? parseUtcTimestamp(dto.resolved_at) : null,
    closedAt: dto.closed_at ? parseUtcTimestamp(dto.closed_at) : null,
  };
}

export function parseUtcTimestamp(value: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Expected an explicit UTC timestamp.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Received an invalid UTC timestamp.');
  }
  return parsed;
}

function personName(person: { readonly first_name: string; readonly last_name: string }): string {
  return `${person.first_name} ${person.last_name}`.trim();
}
