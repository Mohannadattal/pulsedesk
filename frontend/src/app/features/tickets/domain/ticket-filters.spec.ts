import { convertToParamMap } from '@angular/router';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import {
  DEFAULT_PAGE_SIZE,
  parseTicketFilters,
  ticketFiltersToQueryParams,
} from './ticket-filters';

describe('ticket filters', () => {
  it('parses supported values from URL query parameters', () => {
    const filters = parseTicketFilters(
      convertToParamMap({
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        unassigned: 'true',
        page: '3',
        pageSize: '50',
      }),
    );

    expect(filters).toEqual({
      status: TicketStatus.IN_PROGRESS,
      priority: TicketPriority.URGENT,
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
      unassigned: 'false',
      page: null,
      pageSize: null,
    });
  });
});
