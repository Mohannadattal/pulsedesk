import { inject, Injectable } from '@angular/core';
import { forkJoin, map, Observable, of, switchMap } from 'rxjs';

import { CategoriesApi } from '../../../api/generated/api/categories.service';
import { TicketsApi } from '../../../api/generated/api/tickets.service';
import { UsersApi } from '../../../api/generated/api/users.service';
import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketCreate } from '../../../api/generated/model/ticketCreate';
import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketSearchKind } from '../../../api/generated/model/ticketSearchKind';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { TicketEventOrder } from '../../../api/generated/model/ticketEventOrder';
import { UserRole } from '../../../api/generated/model/userRole';
import { Category } from '../domain/category';
import { mapTicketComment, TicketComment, TicketCommentPage } from '../domain/ticket-comment';
import { TicketFilters } from '../domain/ticket-filters';
import { mapTicketActivity, TicketActivityPage } from '../domain/ticket-activity';
import { mapTicket, Ticket, TicketPage } from '../domain/ticket';
import { AgentDirectoryEntry, mapAgentDirectoryEntry } from '../domain/user-directory';

@Injectable({ providedIn: 'root' })
export class TicketsDataAccess {
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly usersApi = inject(UsersApi);

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

  listActiveAgents(): Observable<readonly AgentDirectoryEntry[]> {
    const loadPage = (page: number) =>
      this.usersApi.listUsers(UserRole.AGENT, true, page, 100, 'body', false, {
        transferCache: false,
      });

    return loadPage(1).pipe(
      switchMap((firstPage) => {
        const remainingPages = Array.from(
          { length: Math.max(0, firstPage.total_pages - 1) },
          (_, index) => index + 2,
        );
        const remaining = remainingPages.length
          ? forkJoin(remainingPages.map((page) => loadPage(page)))
          : of([]);
        return remaining.pipe(
          map((pages) =>
            [firstPage, ...pages].flatMap((page) => page.items.map(mapAgentDirectoryEntry)),
          ),
        );
      }),
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
        filters.categoryId,
        filters.assignedToId,
        undefined,
        undefined,
        filters.assignedToId === undefined ? filters.unassigned : undefined,
        filters.page,
        filters.pageSize,
        'body',
        false,
        { transferCache: false },
      )
      .pipe(map(mapTicketPage));
  }

  search(
    kind: TicketSearchKind,
    value: string,
    page: number,
    pageSize: number,
  ): Observable<TicketPage> {
    return this.ticketsApi
      .searchTickets({ kind, value, page, page_size: pageSize }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapTicketPage));
  }

  updateAssignment(ticketId: number, assignedToId: number | null): Observable<Ticket> {
    return this.ticketsApi
      .updateTicketAssignment(ticketId, { assigned_to_id: assignedToId }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapTicket));
  }

  updateStatus(ticketId: number, status: TicketStatus): Observable<Ticket> {
    return this.ticketsApi
      .updateTicketStatus(ticketId, { status }, 'body', false, { transferCache: false })
      .pipe(map(mapTicket));
  }

  updatePriority(ticketId: number, priority: TicketPriority): Observable<Ticket> {
    return this.ticketsApi
      .updateTicketPriority(ticketId, { priority }, 'body', false, { transferCache: false })
      .pipe(map(mapTicket));
  }

  updateCategory(ticketId: number, categoryId: number): Observable<Ticket> {
    return this.ticketsApi
      .updateTicketCategory(ticketId, { category_id: categoryId }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapTicket));
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

  listActivity(ticketId: number, page: number, pageSize: number): Observable<TicketActivityPage> {
    return this.ticketsApi
      .listTicketEvents(ticketId, page, pageSize, TicketEventOrder.desc, 'body', false, {
        transferCache: false,
      })
      .pipe(
        map((response) => ({
          items: response.items.flatMap((event) => {
            const activity = mapTicketActivity(event);
            return activity === null ? [] : [activity];
          }),
          rawPage: response.page,
          rawPageSize: response.page_size,
          rawTotalPages: response.total_pages,
        })),
      );
  }

  addPublicComment(ticketId: number, content: string): Observable<TicketComment> {
    return this.addComment(ticketId, content, CommentVisibility.PUBLIC);
  }

  addComment(
    ticketId: number,
    content: string,
    visibility: CommentVisibility,
  ): Observable<TicketComment> {
    return this.ticketsApi
      .createTicketComment(ticketId, { content, visibility }, 'body', false, {
        transferCache: false,
      })
      .pipe(map(mapTicketComment));
  }
}

function mapTicketPage(response: {
  readonly items: Parameters<typeof mapTicket>[0][];
  readonly page: number;
  readonly page_size: number;
  readonly total: number;
  readonly total_pages: number;
}): TicketPage {
  return {
    items: response.items.map(mapTicket),
    page: response.page,
    pageSize: response.page_size,
    total: response.total,
    totalPages: response.total_pages,
  };
}
