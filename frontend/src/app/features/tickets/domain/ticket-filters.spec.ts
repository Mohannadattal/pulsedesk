import { convertToParamMap } from '@angular/router';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import {
  assignmentFilterState,
  assignmentFilterValue,
  DEFAULT_PAGE_SIZE,
  parseTicketFilters,
  ticketFiltersToQueryParams,
  withFilterChange,
} from './ticket-filters';

describe('ticket filters', () => {
  it('parses supported values from URL query parameters', () => {
    const filters = parseTicketFilters(
      convertToParamMap({
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        categoryId: '14',
        assignedToId: '27',
        unassigned: 'true',
        page: '3',
        pageSize: '50',
      }),
    );

    expect(filters).toEqual({
      status: TicketStatus.IN_PROGRESS,
      priority: TicketPriority.URGENT,
      categoryId: 14,
      assignedToId: 27,
      unassigned: true,
      page: 3,
      pageSize: 50,
    });
  });

  it('falls back safely for invalid or unsupported values', () => {
    const filters = parseTicketFilters(
      convertToParamMap({
        status: 'PENDING',
        priority: 'CRITICAL',
        unassigned: 'yes',
        page: '-1',
        pageSize: '999',
      }),
    );

    expect(filters).toEqual({
      status: undefined,
      priority: undefined,
      categoryId: undefined,
      assignedToId: undefined,
      unassigned: undefined,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('omits defaults and keeps server-supported filter values when serializing', () => {
    expect(
      ticketFiltersToQueryParams({
        status: TicketStatus.OPEN,
        unassigned: false,
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ).toEqual({
      status: TicketStatus.OPEN,
      priority: null,
      categoryId: null,
      assignedToId: null,
      unassigned: 'false',
      page: null,
      pageSize: null,
    });
  });

  it('serializes category and specific-Agent filters', () => {
    expect(
      ticketFiltersToQueryParams({
        categoryId: 8,
        assignedToId: 19,
        page: 2,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ).toEqual({
      status: null,
      priority: null,
      categoryId: 8,
      assignedToId: 19,
      unassigned: null,
      page: 2,
      pageSize: null,
    });
  });

  it('never emits contradictory assignment parameters', () => {
    expect(
      ticketFiltersToQueryParams({
        assignedToId: 19,
        unassigned: true,
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ).toMatchObject({ assignedToId: 19, unassigned: null });
  });

  it.each([
    [{}, { assignedToId: undefined, unassigned: undefined }],
    [{ unassigned: 'true' }, { assignedToId: undefined, unassigned: true }],
    [{ unassigned: 'false' }, { assignedToId: undefined, unassigned: false }],
    [{ assignedToId: 5 }, { assignedToId: 5, unassigned: undefined }],
  ])('parses assignment URL state %#', (query, expected) => {
    expect(parseTicketFilters(convertToParamMap(query))).toMatchObject(expected);
  });

  it.each([
    ['', { assignedToId: undefined, unassigned: undefined }],
    ['unassigned', { assignedToId: undefined, unassigned: true }],
    ['assigned', { assignedToId: undefined, unassigned: false }],
    ['mine', { assignedToId: 12, unassigned: undefined }],
    ['agent:31', { assignedToId: 31, unassigned: undefined }],
  ] as const)('maps the %s assignment choice to canonical URL state', (choice, expected) => {
    expect(assignmentFilterState(choice, 12)).toEqual(expected);
  });

  it('recognizes Mine and a specific Agent when restoring URL state', () => {
    expect(assignmentFilterValue({ assignedToId: 12, page: 1, pageSize: 20 }, 12)).toBe('mine');
    expect(assignmentFilterValue({ assignedToId: 31, page: 1, pageSize: 20 }, 12)).toBe('agent:31');
  });

  it('resets the page when a filter changes', () => {
    expect(
      withFilterChange({ status: TicketStatus.OPEN, page: 7, pageSize: 50 }, { categoryId: 4 }),
    ).toEqual({ status: TicketStatus.OPEN, categoryId: 4, page: 1, pageSize: 50 });
  });
});
