import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';

import { CategoriesApi } from '../../../api/generated/api/categories.service';
import { TicketsApi } from '../../../api/generated/api/tickets.service';
import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketCreate } from '../../../api/generated/model/ticketCreate';
import { Category } from '../domain/category';
import { mapTicketComment, TicketComment, TicketCommentPage } from '../domain/ticket-comment';
import { TicketFilters } from '../domain/ticket-filters';
import { mapTicket, Ticket, TicketPage } from '../domain/ticket';

@Injectable({ providedIn: 'root' })
export class TicketsDataAccess {
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly ticketsApi = inject(TicketsApi);

  listActiveCategories(): Observable<readonly Category[]> {
    return this.categoriesApi
      .listCategories(false, 'body', false, { transferCache: false })
      .pipe(
        map((categories) =>
          categories
            .filter((category) => category.is_active)
            .map((category) => ({ id: category.id, name: category.name })),
        ),
      );
  }

  create(request: TicketCreate): Observable<Ticket> {
    return this.ticketsApi
      .createTicket(request, 'body', false, { transferCache: false })
      .pipe(map(mapTicket));
  }

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

  listComments(ticketId: number, page: number, pageSize: number): Observable<TicketCommentPage> {
    return this.ticketsApi
      .listTicketComments(ticketId, page, pageSize, 'body', false, { transferCache: false })
      .pipe(
        map((response) => ({
          items: response.items.map(mapTicketComment),
          page: response.page,
          pageSize: response.page_size,
          total: response.total,
          totalPages: response.total_pages,
        })),
      );
  }

  addPublicComment(ticketId: number, content: string): Observable<TicketComment> {
    return this.ticketsApi
      .createTicketComment(
        ticketId,
        { content, visibility: CommentVisibility.PUBLIC },
        'body',
        false,
        { transferCache: false },
      )
      .pipe(map(mapTicketComment));
  }
}
