import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { TicketsApi } from '../../../api/generated/api/tickets.service';
import { TicketFilters } from '../domain/ticket-filters';
import { mapTicket, Ticket, TicketPage } from '../domain/ticket';

@Injectable({ providedIn: 'root' })
export class TicketsDataAccess {
  private readonly ticketsApi = inject(TicketsApi);

  list(filters: TicketFilters): Observable<TicketPage> {
    return this.ticketsApi
      .listTickets(
        filters.status,
        filters.priority,
        undefined,
        undefined,
        undefined,
        filters.unassigned,
        filters.page,
        filters.pageSize,
        'body',
        false,
        { transferCache: false },
      )
      .pipe(
        map((response) => ({
          items: response.items.map(mapTicket),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
      );
  }

  get(ticketId: number): Observable<Ticket> {
    return this.ticketsApi
      .getTicket(ticketId, 'body', false, { transferCache: false })
      .pipe(map(mapTicket));
  }
}
