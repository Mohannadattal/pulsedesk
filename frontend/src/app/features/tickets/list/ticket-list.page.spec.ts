import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Params, Router } from '@angular/router';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';

import { TicketPriority } from '../../../api/generated/model/ticketPriority';
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
    })
      .overrideComponent(TicketListPage, { set: { template: '' } })
      .compileComponents();
    fixture = TestBed.createComponent(TicketListPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => vi.clearAllMocks());

  it('removes Employee support filters and keeps them out of the backend request', async () => {
    await render(UserRole.EMPLOYEE, {
      status: 'OPEN',
      categoryId: '4',
      assignedToId: '5',
      unassigned: 'true',
      page: '3',
    });

    expect(tickets.list).toHaveBeenCalledWith({
      status: TicketStatus.OPEN,
      priority: undefined,
      categoryId: undefined,
      assignedToId: undefined,
      unassigned: undefined,
      page: 3,
      pageSize: 20,
    });
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({
        status: TicketStatus.OPEN,
        categoryId: null,
        assignedToId: null,
        unassigned: null,
        page: 3,
      }),
      replaceUrl: true,
    });
    expect(tickets.listActiveCategories).not.toHaveBeenCalled();
    expect(tickets.listActiveAgents).not.toHaveBeenCalled();
  });

  it('does not preserve hidden support filters when an Employee changes a visible filter', async () => {
    await render(UserRole.EMPLOYEE, { categoryId: '4', assignedToId: '5', page: '8' });
    router.navigate.mockClear();

    fixture.componentInstance['filterForm'].controls.priority.setValue(TicketPriority.HIGH);
    fixture.componentInstance['applyFilters']();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({
        priority: TicketPriority.HIGH,
        categoryId: null,
        assignedToId: null,
        unassigned: null,
        page: null,
      }),
    });
  });

  it('canonicalizes contradictory assignment state with the specific Agent taking precedence', async () => {
    await render(UserRole.AGENT, { assignedToId: '5', unassigned: 'true' });

    expect(tickets.list).toHaveBeenCalledWith(
      expect.objectContaining({ assignedToId: 5, unassigned: undefined }),
    );
    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({ assignedToId: 5, unassigned: null }),
      replaceUrl: true,
    });
  });

  it('removes invalid and explicit default URL values', async () => {
    await render(UserRole.AGENT, {
      status: 'PENDING',
      priority: 'CRITICAL',
      categoryId: '-4',
      assignedToId: 'nope',
      unassigned: 'maybe',
      page: '1',
      pageSize: '20',
    });

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: {
        status: null,
        priority: null,
        categoryId: null,
        assignedToId: null,
        unassigned: null,
        page: null,
        pageSize: null,
      },
      replaceUrl: true,
    });
    expect(tickets.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  it('removes a stale category and resets the page only after a successful reference load', async () => {
    const categories = new Subject<readonly Category[]>();
    await render(UserRole.ADMIN, { categoryId: '99', page: '4' }, categories);
    expect(tickets.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: 99, page: 4 }),
    );

    categories.next([{ id: 4, name: 'Hardware' }]);

    expect(tickets.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: undefined, page: 1 }),
    );
    expect(router.navigate).toHaveBeenLastCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({ categoryId: null, page: null }),
      replaceUrl: true,
    });
  });

  it('removes a stale Agent and resets the page after a successful directory load', async () => {
    const agents = new Subject<readonly AgentDirectoryEntry[]>();
    await render(UserRole.AGENT, { assignedToId: '99', page: '6' }, undefined, agents);

    agents.next([{ id: 5, name: 'Ada Agent' }]);

    expect(tickets.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignedToId: undefined, page: 1 }),
    );
    expect(router.navigate).toHaveBeenLastCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({ assignedToId: null, page: null }),
      replaceUrl: true,
    });
  });

  it('does not erase an unresolved reference filter when reference loading fails', async () => {
    await render(
      UserRole.AGENT,
      { categoryId: '99', assignedToId: '88', page: '2' },
      throwError(() => new Error('categories unavailable')),
      throwError(() => new Error('agents unavailable')),
    );

    expect(tickets.list).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 99, assignedToId: 88, page: 2 }),
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('resets the page on a filter change', async () => {
    await render(UserRole.AGENT, { page: '7' });
    router.navigate.mockClear();

    fixture.componentInstance['filterForm'].controls.status.setValue(TicketStatus.RESOLVED);
    fixture.componentInstance['applyFilters']();

    expect(router.navigate).toHaveBeenCalledWith([], {
      relativeTo: route,
      queryParams: expect.objectContaining({ status: TicketStatus.RESOLVED, page: null }),
    });
  });

  it('uses replace semantics once and does not reload when the canonical URL arrives', async () => {
    await render(UserRole.AGENT, { status: 'INVALID', page: '1' });
    expect(router.navigate).toHaveBeenCalledOnce();
    expect(tickets.list).toHaveBeenCalledOnce();

    const canonical = convertToParamMap({});
    route.snapshot.queryParamMap = canonical;
    queryParams.next(canonical);

    expect(router.navigate).toHaveBeenCalledOnce();
    expect(tickets.list).toHaveBeenCalledOnce();
  });
});
