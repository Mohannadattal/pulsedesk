import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Params, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketSearchKind } from '../../../api/generated/model/ticketSearchKind';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { AuthSessionStore } from '../../../platform/auth/auth-session.store';
import { TicketsDataAccess } from '../data-access/tickets-data-access';
import { Category } from '../domain/category';
import { TicketFilters } from '../domain/ticket-filters';
import { TicketPage } from '../domain/ticket';
import { AgentDirectoryEntry } from '../domain/user-directory';
import { TicketListPage } from './ticket-list.page';

const EMPTY_PAGE: TicketPage = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0,
};

const EXACT_PAGE: TicketPage = {
  ...EMPTY_PAGE,
  items: [
    {
      id: 12,
      ticketNumber: 'TKT-4ZFUPC6W7ZFJDEWY',
      title: 'Outlook issue',
      description: 'Description',
      status: TicketStatus.OPEN,
      priority: TicketPriority.MEDIUM,
      category: { id: 1, name: 'Support' },
      creator: { id: 3, name: 'Emma Employee' },
      assignee: null,
      customer: null,
      customerWasVerified: false,
      resolutionSummary: null,
      createdAt: new Date('2026-09-18T08:00:00Z'),
      updatedAt: new Date('2026-09-18T08:00:00Z'),
      resolvedAt: null,
      closedAt: null,
    },
  ],
  total: 1,
  totalPages: 1,
};

describe('TicketListPage canonical URL state', () => {
  let fixture: ComponentFixture<TicketListPage>;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let route: {
    snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    queryParamMap: Observable<ReturnType<typeof convertToParamMap>>;
  };
  const router = { navigate: vi.fn(() => Promise.resolve(true)) };
  const session = { currentUser: vi.fn() };
  const tickets = {
    list: vi.fn<(_filters: TicketFilters) => Observable<TicketPage>>(),
    listActiveCategories: vi.fn<() => Observable<readonly Category[]>>(),
    listActiveAgents: vi.fn<() => Observable<readonly AgentDirectoryEntry[]>>(),
    search:
      vi.fn<
        (
          kind: TicketSearchKind,
          value: string,
          page: number,
          pageSize: number,
        ) => Observable<TicketPage>
      >(),
  };

  async function render(
    role: UserRole,
    query: Params,
    categories: Observable<readonly Category[]> = of([{ id: 4, name: 'Hardware' }]),
    agents: Observable<readonly AgentDirectoryEntry[]> = of([{ id: 5, name: 'Ada Agent' }]),
  ): Promise<void> {
    const initial = convertToParamMap(query);
    queryParams = new BehaviorSubject(initial);
    route = { snapshot: { queryParamMap: initial }, queryParamMap: queryParams };
    session.currentUser.mockReturnValue({ id: 5, role });
    tickets.list.mockReturnValue(of(EMPTY_PAGE));
    tickets.search.mockReturnValue(of(EMPTY_PAGE));
    tickets.listActiveCategories.mockReturnValue(categories);
    tickets.listActiveAgents.mockReturnValue(agents);

    await TestBed.configureTestingModule({
      imports: [TicketListPage],
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: Router, useValue: router },
        { provide: AuthSessionStore, useValue: session },
        { provide: TicketsDataAccess, useValue: tickets },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TicketListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => vi.clearAllMocks());

  it('starts EMPLOYEE search-first without queue or reference-data requests', async () => {
    await render(UserRole.EMPLOYEE, {
      status: 'OPEN',
      categoryId: '4',
      assignedToId: '5',
      unassigned: 'true',
      page: '3',
    });

    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
    expect(tickets.search).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance['state']().kind).toBe('idle');
    expect(fixture.nativeElement.textContent).toContain('Find ticket');
    expect(fixture.nativeElement.textContent).toContain('Find a ticket');
    expect(fixture.nativeElement.textContent).not.toContain('My tickets');
    expect(fixture.nativeElement.textContent).not.toContain('Track the requests you have raised');
    expect(fixture.nativeElement.textContent).toContain('Create ticket');
    expect(fixture.nativeElement.querySelector('.filters')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
  });

  it('EMPLOYEE title search clears the draft and preserves its executed query for pagination', async () => {
    await render(UserRole.EMPLOYEE, {});
    const result = { ...EXACT_PAGE, total: 40, totalPages: 2 };
    tickets.search.mockReturnValue(of(result));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });

    fixture.componentInstance['executeSearch']();
    fixture.componentInstance['changeSearchPage']({
      pageIndex: 1,
      pageSize: 20,
      length: 40,
      previousPageIndex: 0,
    });

    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
    expect(fixture.componentInstance['executedSearch']).toEqual({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
      pageSize: 20,
    });
    expect(tickets.search).toHaveBeenNthCalledWith(1, TicketSearchKind.TITLE, 'Outlook', 1, 20);
    expect(tickets.search).toHaveBeenNthCalledWith(2, TicketSearchKind.TITLE, 'Outlook', 2, 20);
    expect(tickets.list).not.toHaveBeenCalled();
  });

  it('EMPLOYEE failed search retains its draft and previous executed search', async () => {
    await render(UserRole.EMPLOYEE, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });
    fixture.componentInstance['executeSearch']();
    tickets.search.mockReturnValueOnce(throwError(() => new Error('search failed')));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Printer',
    });

    fixture.componentInstance['executeSearch']();

    expect(fixture.componentInstance['searchState']().kind).toBe('error');
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('Printer');
    expect(fixture.componentInstance['executedSearch']).toEqual({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
      pageSize: 20,
    });
  });

  it('EMPLOYEE Clear and repeated Clear remain idle without loading a queue', async () => {
    await render(UserRole.EMPLOYEE, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });
    fixture.componentInstance['executeSearch']();

    fixture.componentInstance['clearSearch']();
    fixture.componentInstance['clearSearch']();
    fixture.detectChanges();

    expect(fixture.componentInstance['searchState']().kind).toBe('idle');
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
    expect(fixture.componentInstance['executedSearch']).toBeNull();
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
  });

  it('starts AGENT search-first without loading the queue or queue reference data', async () => {
    await render(UserRole.AGENT, {});

    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
    expect(fixture.componentInstance['state']().kind).toBe('idle');
    expect(fixture.nativeElement.textContent).toContain('Find ticket');
    expect(fixture.nativeElement.textContent).toContain('Find a ticket');
    expect(fixture.nativeElement.querySelector('.filters')).toBeNull();
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
  });

  it('renders an AGENT TITLE result, clears its draft, and paginates the executed query', async () => {
    await render(UserRole.AGENT, {});
    const result = { ...EXACT_PAGE, total: 40, totalPages: 2 };
    tickets.search.mockReturnValue(of(result));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });
    fixture.componentInstance['executeSearch']();

    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
    expect(fixture.componentInstance['searchForm'].controls.kind.value).toBe(
      TicketSearchKind.TITLE,
    );
    expect(fixture.componentInstance['searchState']()).toEqual(
      expect.objectContaining({ kind: 'loaded', page: result }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.ticket-table')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Outlook issue');

    fixture.componentInstance['searchForm'].controls.value.setValue('Printer');

    expect(fixture.componentInstance['searchState']()).toEqual(
      expect.objectContaining({ kind: 'loaded', page: result }),
    );

    fixture.componentInstance['changeSearchPage']({
      pageIndex: 1,
      pageSize: 20,
      length: 40,
      previousPageIndex: 0,
    });

    expect(tickets.search).toHaveBeenNthCalledWith(1, TicketSearchKind.TITLE, 'Outlook', 1, 20);
    expect(tickets.search).toHaveBeenNthCalledWith(2, TicketSearchKind.TITLE, 'Outlook', 2, 20);
  });

  it('preserves a failed search draft and prior executed query', async () => {
    await render(UserRole.AGENT, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });
    fixture.componentInstance['executeSearch']();
    tickets.search.mockReturnValueOnce(throwError(() => new Error('search failed')));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Printer',
    });

    fixture.componentInstance['executeSearch']();

    expect(fixture.componentInstance['searchState']().kind).toBe('error');
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('Printer');
    expect(fixture.componentInstance['executedSearch']).toEqual({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
      pageSize: 20,
    });
  });

  it('AGENT Clear removes results and returns to search-first without loading the queue', async () => {
    await render(UserRole.AGENT, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });
    fixture.componentInstance['executeSearch']();

    fixture.componentInstance['clearSearch']();
    fixture.detectChanges();

    expect(fixture.componentInstance['searchState']().kind).toBe('idle');
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
    expect(fixture.componentInstance['executedSearch']).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Find a ticket');
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
  });

  it('repeated AGENT Clear remains idle without loading the queue', async () => {
    await render(UserRole.AGENT, {});

    fixture.componentInstance['clearSearch']();
    fixture.componentInstance['clearSearch']();

    expect(fixture.componentInstance['searchState']().kind).toBe('idle');
    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
  });

  it('starts ADMIN in a search-first empty state without an organization queue request', async () => {
    await render(UserRole.ADMIN, {});

    expect(tickets.list).not.toHaveBeenCalled();
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
    expect(fixture.componentInstance['state']().kind).toBe('idle');
    expect(fixture.nativeElement.textContent).toContain('Find a ticket');
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
  });

  it('ADMIN search and Clear return to search-first state without fetching the queue', async () => {
    await render(UserRole.ADMIN, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });

    fixture.componentInstance['executeSearch']();

    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
    expect(fixture.componentInstance['searchState']().kind).toBe('loaded');

    fixture.componentInstance['clearSearch']();

    expect(fixture.componentInstance['searchState']().kind).toBe('idle');
    expect(tickets.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.ticket-table')).toBeNull();
  });

  it('EMPLOYEE exact Ticket Number search navigates directly to authorized Ticket Detail', async () => {
    await render(UserRole.EMPLOYEE, {});
    tickets.search.mockReturnValueOnce(of(EXACT_PAGE));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TICKET_NUMBER,
      value: 'tkt-4zfupc6w7zfjdewy',
    });

    fixture.componentInstance['executeSearch']();

    expect(tickets.search).toHaveBeenCalledWith(
      TicketSearchKind.TICKET_NUMBER,
      'TKT-4ZFUPC6W7ZFJDEWY',
      1,
      20,
    );
    expect(router.navigate).toHaveBeenCalledWith(['/tickets', 12]);
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('');
  });

  it('ADMIN failed search preserves its draft and stays out of the queue', async () => {
    await render(UserRole.ADMIN, {});
    tickets.search.mockReturnValueOnce(throwError(() => new Error('search failed')));
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Outlook',
    });

    fixture.componentInstance['executeSearch']();

    expect(fixture.componentInstance['searchState']().kind).toBe('error');
    expect(fixture.componentInstance['searchForm'].controls.value.value).toBe('Outlook');
    expect(tickets.list).not.toHaveBeenCalled();
  });

  it('cancels stale searches so an older response cannot replace newer successful state', async () => {
    const oldRequest = new Subject<TicketPage>();
    const newPage = { ...EMPTY_PAGE, total: 1 };
    await render(UserRole.AGENT, {});
    tickets.search.mockReturnValueOnce(oldRequest).mockReturnValueOnce(of(newPage));

    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TITLE,
      value: 'Old',
    });
    fixture.componentInstance['executeSearch']();
    fixture.componentInstance['searchForm'].controls.value.setValue('New');
    fixture.componentInstance['executeSearch']();
    oldRequest.next({ ...EMPTY_PAGE, total: 99 });

    expect(fixture.componentInstance['searchState']()).toEqual(
      expect.objectContaining({ kind: 'loaded', page: newPage }),
    );
    expect(fixture.componentInstance['executedSearch']).toEqual({
      kind: TicketSearchKind.TITLE,
      value: 'New',
      pageSize: 20,
    });
  });

  it('rejects malformed Ticket Numbers before sending a request', async () => {
    await render(UserRole.AGENT, {});
    fixture.componentInstance['searchForm'].setValue({
      kind: TicketSearchKind.TICKET_NUMBER,
      value: 'TKT-123',
    });

    fixture.componentInstance['executeSearch']();

    expect(tickets.search).not.toHaveBeenCalled();
    expect(fixture.componentInstance['searchValidationError']()).toContain('valid ticket number');
  });
});
