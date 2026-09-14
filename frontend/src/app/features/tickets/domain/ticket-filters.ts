import { ParamMap, Params } from '@angular/router';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';

export interface TicketFilters {
  readonly status?: TicketStatus;
  readonly priority?: TicketPriority;
  readonly unassigned?: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];
export const TICKET_STATUSES: readonly TicketStatus[] = Object.values(TicketStatus);
export const TICKET_PRIORITIES: readonly TicketPriority[] = Object.values(TicketPriority);

export function parseTicketFilters(params: ParamMap): TicketFilters {
  return {
    status: parseEnum(params.get('status'), TICKET_STATUSES),
    priority: parseEnum(params.get('priority'), TICKET_PRIORITIES),
    unassigned: parseBoolean(params.get('unassigned')),
    page: parsePositiveInteger(params.get('page')) ?? 1,
    pageSize: parsePageSize(params.get('pageSize')),
  };
}

export function ticketFiltersToQueryParams(filters: TicketFilters): Params {
  return {
    status: filters.status ?? null,
    priority: filters.priority ?? null,
    unassigned: filters.unassigned === undefined ? null : String(filters.unassigned),
    page: filters.page > 1 ? filters.page : null,
    pageSize: filters.pageSize !== DEFAULT_PAGE_SIZE ? filters.pageSize : null,
  };
}

export function sameTicketFilters(left: TicketFilters, right: TicketFilters): boolean {
  return (
    left.status === right.status &&
    left.priority === right.priority &&
    left.unassigned === right.unassigned &&
    left.page === right.page &&
    left.pageSize === right.pageSize
  );
}

export function hasActiveTicketFilters(filters: TicketFilters): boolean {
  return Boolean(filters.status || filters.priority || filters.unassigned !== undefined);
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
