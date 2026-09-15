import { ParamMap, Params } from '@angular/router';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';

export interface TicketFilters {
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly categoryId?: number;
  readonly assignedToId?: number;
  readonly unassigned?: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export type TicketAssignmentFilter = '' | 'assigned' | 'unassigned' | 'mine' | `agent:${number}`;

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];
export const TICKET_STATUSES: readonly TicketStatus[] = Object.values(TicketStatus);
export const TICKET_PRIORITIES: readonly TicketPriority[] = Object.values(TicketPriority);

export function parseTicketFilters(params: ParamMap): TicketFilters {
  return {
    status: parseEnum(params.get('status'), TICKET_STATUSES),
    priority: parseEnum(params.get('priority'), TICKET_PRIORITIES),
    categoryId: parsePositiveInteger(params.get('categoryId')),
    assignedToId: parsePositiveInteger(params.get('assignedToId')),
    unassigned: parseBoolean(params.get('unassigned')),
    page: parsePositiveInteger(params.get('page')) ?? 1,
    pageSize: parsePageSize(params.get('pageSize')),
  };
}

export function ticketFiltersToQueryParams(filters: TicketFilters): Params {
  const assignedToId = filters.assignedToId;
  return {
    status: filters.status ?? null,
    priority: filters.priority ?? null,
    categoryId: filters.categoryId ?? null,
    assignedToId: assignedToId ?? null,
    unassigned:
      assignedToId !== undefined || filters.unassigned === undefined
        ? null
        : String(filters.unassigned),
    page: filters.page > 1 ? filters.page : null,
    pageSize: filters.pageSize !== DEFAULT_PAGE_SIZE ? filters.pageSize : null,
  };
}

export function sameTicketFilters(left: TicketFilters, right: TicketFilters): boolean {
  return (
    left.status === right.status &&
    left.priority === right.priority &&
    left.categoryId === right.categoryId &&
    left.assignedToId === right.assignedToId &&
    left.unassigned === right.unassigned &&
    left.page === right.page &&
    left.pageSize === right.pageSize
  );
}

export function hasActiveTicketFilters(filters: TicketFilters): boolean {
  return Boolean(
    filters.status ||
    filters.priority ||
    filters.categoryId ||
    filters.assignedToId ||
    filters.unassigned !== undefined,
  );
}

export function assignmentFilterValue(
  filters: TicketFilters,
  currentUserId?: number,
): TicketAssignmentFilter {
  if (filters.assignedToId !== undefined) {
    return filters.assignedToId === currentUserId ? 'mine' : `agent:${filters.assignedToId}`;
  }
  if (filters.unassigned === true) {
    return 'unassigned';
  }
  if (filters.unassigned === false) {
    return 'assigned';
  }
  return '';
}

export function assignmentFilterState(
  assignment: TicketAssignmentFilter,
  currentUserId?: number,
): Pick<TicketFilters, 'assignedToId' | 'unassigned'> {
  if (assignment === 'mine' && currentUserId !== undefined) {
    return { assignedToId: currentUserId, unassigned: undefined };
  }
  if (assignment.startsWith('agent:')) {
    const agentId = parsePositiveInteger(assignment.slice('agent:'.length));
    return { assignedToId: agentId, unassigned: undefined };
  }
  if (assignment === 'assigned' || assignment === 'unassigned') {
    return { assignedToId: undefined, unassigned: assignment === 'unassigned' };
  }
  return { assignedToId: undefined, unassigned: undefined };
}

export function withFilterChange(
  current: TicketFilters,
  changes: Partial<Omit<TicketFilters, 'page' | 'pageSize'>>,
): TicketFilters {
  return { ...current, ...changes, page: 1 };
}

function parseEnum<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return value && values.includes(value as T) ? (value as T) : undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePageSize(value: string | null): number {
  const parsed = parsePositiveInteger(value);
  return parsed && PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}
