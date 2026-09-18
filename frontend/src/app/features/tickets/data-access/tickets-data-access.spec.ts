import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { CategoriesApi } from '../../../api/generated/api/categories.service';
import { TicketsApi } from '../../../api/generated/api/tickets.service';
import { UsersApi } from '../../../api/generated/api/users.service';
import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketPriority } from '../../../api/generated/model/ticketPriority';
import { TicketEventOrder } from '../../../api/generated/model/ticketEventOrder';
import { TicketEventType } from '../../../api/generated/model/ticketEventType';
import { TicketStatus } from '../../../api/generated/model/ticketStatus';
import { UserRole } from '../../../api/generated/model/userRole';
import { TicketsDataAccess } from './tickets-data-access';

describe('TicketsDataAccess', () => {
  const categoriesApi = { listCategories: vi.fn() };
  const ticketsApi = {
    createTicketComment: vi.fn(),
    listTickets: vi.fn(),
    listTicketEvents: vi.fn(),
    updateTicketAssignment: vi.fn(),
    updateTicketStatus: vi.fn(),
    updateTicketPriority: vi.fn(),
    updateTicketCategory: vi.fn(),
  };
  const usersApi = { listUsers: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        TicketsDataAccess,
        { provide: CategoriesApi, useValue: categoriesApi },
        { provide: TicketsApi, useValue: ticketsApi },
        { provide: UsersApi, useValue: usersApi },
      ],
    });
  });

  it('retrieves and maps every active Agent page without email', async () => {
    usersApi.listUsers.mockImplementation((_role: UserRole, _active: boolean, page: number) =>
      of({
        items: [
          {
            id: page,
            first_name: page === 1 ? 'Ada' : 'Grace',
            last_name: page === 1 ? 'Agent' : 'Helper',
            role: UserRole.AGENT,
            is_active: true,
          },
        ],
        page,
        page_size: 100,
        total: 2,
        total_pages: 2,
      }),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActiveAgents());

    expect(result).toEqual([
      { id: 1, name: 'Ada Agent' },
      { id: 2, name: 'Grace Helper' },
    ]);
    expect(usersApi.listUsers).toHaveBeenNthCalledWith(
      1,
      UserRole.AGENT,
      true,
      1,
      100,
      'body',
      false,
      { transferCache: false },
    );
    expect(usersApi.listUsers).toHaveBeenNthCalledWith(
      2,
      UserRole.AGENT,
      true,
      2,
      100,
      'body',
      false,
      { transferCache: false },
    );
    expect(result[0]).not.toHaveProperty('email');
  });

  it('does not request extra Agent-directory pages for a one-page result', async () => {
    usersApi.listUsers.mockReturnValue(
      of({
        items: [
          {
            id: 1,
            first_name: 'Ada',
            last_name: 'Agent',
            role: UserRole.AGENT,
            is_active: true,
          },
        ],
        page: 1,
        page_size: 100,
        total: 1,
        total_pages: 1,
      }),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActiveAgents());

    expect(result).toEqual([{ id: 1, name: 'Ada Agent' }]);
    expect(usersApi.listUsers).toHaveBeenCalledOnce();
  });

  it('derives every remaining Agent-directory page from first-page total_pages', async () => {
    usersApi.listUsers.mockImplementation((_role: UserRole, _active: boolean, page: number) =>
      of({
        items: [
          {
            id: page,
            first_name: `Agent${page}`,
            last_name: 'User',
            role: UserRole.AGENT,
            is_active: true,
          },
        ],
        page,
        page_size: 100,
        total: 4,
        total_pages: page === 1 ? 4 : 99,
      }),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActiveAgents());

    expect(result.map((agent) => agent.id)).toEqual([1, 2, 3, 4]);
    expect(usersApi.listUsers).toHaveBeenCalledTimes(4);
    expect(usersApi.listUsers.mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 4]);
  });

  it('fails the Agent directory when any authoritative page fails', async () => {
    usersApi.listUsers.mockImplementation((_role: UserRole, _active: boolean, page: number) =>
      page === 1
        ? of({ items: [], page: 1, page_size: 100, total: 2, total_pages: 2 })
        : throwError(() => new Error('directory unavailable')),
    );

    await expect(
      firstValueFrom(TestBed.inject(TicketsDataAccess).listActiveAgents()),
    ).rejects.toThrow('directory unavailable');
  });

  it('maps URL-derived queue filters to generated-client parameters', async () => {
    ticketsApi.listTickets.mockReturnValue(
      of({ items: [], page: 1, page_size: 20, total: 0, total_pages: 0 }),
    );

    await firstValueFrom(
      TestBed.inject(TicketsDataAccess).list({
        status: TicketStatus.OPEN,
        priority: TicketPriority.HIGH,
        categoryId: 4,
        assignedToId: 8,
        unassigned: true,
        page: 1,
        pageSize: 20,
      }),
    );

    expect(ticketsApi.listTickets).toHaveBeenCalledWith(
      TicketStatus.OPEN,
      TicketPriority.HIGH,
      4,
      8,
      undefined,
      undefined,
      undefined,
      1,
      20,
      'body',
      false,
      { transferCache: false },
    );
  });

  it('requests descending raw Activity pages and maps away suppressed rows', async () => {
    ticketsApi.listTicketEvents.mockReturnValue(
      of({
        items: [
          {
            id: 2,
            ticket_id: 17,
            event_type: TicketEventType.TICKET_RESOLVED,
            actor_id: 4,
            actor: { id: 4, display_name: 'Ada Agent' },
            field_name: null,
            old_value: null,
            new_value: null,
            old_display_value: null,
            new_display_value: null,
            comment: null,
            metadata: null,
            created_at: '2026-09-15T10:00:00Z',
          },
          {
            id: 1,
            ticket_id: 17,
            event_type: TicketEventType.STATUS_CHANGED,
            actor_id: 4,
            actor: { id: 4, display_name: 'Ada Agent' },
            field_name: 'status',
            old_value: 'IN_PROGRESS',
            new_value: 'RESOLVED',
            old_display_value: null,
            new_display_value: null,
            comment: null,
            metadata: null,
            created_at: '2026-09-15T10:00:00Z',
          },
        ],
        page: 2,
        page_size: 20,
        total: 42,
        total_pages: 3,
      }),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActivity(17, 2, 20));

    expect(ticketsApi.listTicketEvents).toHaveBeenCalledWith(
      17,
      2,
      20,
      TicketEventOrder.desc,
      'body',
      false,
      { transferCache: false },
    );
    expect(result).toMatchObject({ rawPage: 2, rawPageSize: 20, rawTotalPages: 3 });
    expect(result.items.map((item) => item.id)).toEqual([2]);
  });

  it('keeps a malformed resolved-status row visible instead of suppressing the raw page', async () => {
    ticketsApi.listTicketEvents.mockReturnValue(
      of({
        items: [
          {
            id: 1,
            ticket_id: 17,
            event_type: TicketEventType.STATUS_CHANGED,
            actor_id: 4,
            actor: { id: 4, display_name: 'Ada Agent' },
            field_name: 'priority',
            old_value: 'IN_PROGRESS',
            new_value: 'RESOLVED',
            old_display_value: null,
            new_display_value: null,
            comment: null,
            metadata: {},
            created_at: '2026-09-15T10:00:00Z',
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
        total_pages: 1,
      }),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActivity(17, 1, 20));

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 1,
        description: 'Unsupported ticket activity.',
        kind: 'unsupported',
      }),
    ]);
  });

  it('sends exact mutation bodies and preserves embedded historical assignee display', async () => {
    const response = {
      id: 17,
      ticket_number: 'TKT-17',
      title: 'Printer unavailable',
      description: 'Offline',
      status: TicketStatus.IN_PROGRESS,
      priority: TicketPriority.HIGH,
      category_id: 4,
      category: { id: 4, name: 'Hardware' },
      created_by_id: 9,
      created_by: { id: 9, first_name: 'Eli', last_name: 'Employee' },
      assigned_to_id: 88,
      assigned_to: { id: 88, first_name: 'Former', last_name: 'Agent' },
      created_at: '2026-09-15T08:00:00Z',
      updated_at: '2026-09-15T09:00:00Z',
      resolved_at: null,
      closed_at: null,
    };
    ticketsApi.updateTicketAssignment.mockReturnValue(of(response));
    ticketsApi.updateTicketStatus.mockReturnValue(of(response));
    ticketsApi.updateTicketPriority.mockReturnValue(of(response));
    ticketsApi.updateTicketCategory.mockReturnValue(of(response));
    const dataAccess = TestBed.inject(TicketsDataAccess);

    const assigned = await firstValueFrom(dataAccess.updateAssignment(17, 88));
    await firstValueFrom(dataAccess.updateAssignment(17, null));
    await firstValueFrom(dataAccess.updateStatus(17, TicketStatus.IN_PROGRESS));
    await firstValueFrom(dataAccess.updatePriority(17, TicketPriority.HIGH));
    await firstValueFrom(dataAccess.updateCategory(17, 4));

    expect(ticketsApi.updateTicketAssignment).toHaveBeenNthCalledWith(
      1,
      17,
      { assigned_to_id: 88 },
      'body',
      false,
      { transferCache: false },
    );
    expect(ticketsApi.updateTicketAssignment).toHaveBeenNthCalledWith(
      2,
      17,
      { assigned_to_id: null },
      'body',
      false,
      { transferCache: false },
    );
    expect(ticketsApi.updateTicketStatus).toHaveBeenCalledWith(
      17,
      { status: TicketStatus.IN_PROGRESS },
      'body',
      false,
      { transferCache: false },
    );
    expect(ticketsApi.updateTicketPriority).toHaveBeenCalledWith(
      17,
      { priority: TicketPriority.HIGH },
      'body',
      false,
      { transferCache: false },
    );
    expect(ticketsApi.updateTicketCategory).toHaveBeenCalledWith(
      17,
      { category_id: 4 },
      'body',
      false,
      { transferCache: false },
    );
    expect(assigned.assignee).toEqual({ id: 88, name: 'Former Agent' });
  });

  it('returns active categories only', async () => {
    categoriesApi.listCategories.mockReturnValue(
      of([
        {
          id: 1,
          name: 'Hardware',
          description: null,
          is_active: true,
          created_at: '2026-09-15T08:00:00Z',
          updated_at: '2026-09-15T08:00:00Z',
        },
        {
          id: 2,
          name: 'Retired',
          description: null,
          is_active: false,
          created_at: '2026-09-15T08:00:00Z',
          updated_at: '2026-09-15T08:00:00Z',
        },
      ]),
    );

    const result = await firstValueFrom(TestBed.inject(TicketsDataAccess).listActiveCategories());

    expect(result).toEqual([{ id: 1, name: 'Hardware' }]);
    expect(categoriesApi.listCategories).toHaveBeenCalledWith(false, 'body', false, {
      transferCache: false,
    });
  });

  it('always sends employee comments with PUBLIC visibility', async () => {
    ticketsApi.createTicketComment.mockReturnValue(
      of({
        id: 3,
        ticket_id: 7,
        author_id: 9,
        author: { id: 9, first_name: 'Eli', last_name: 'Employee' },
        content: 'Any update?',
        visibility: CommentVisibility.PUBLIC,
        created_at: '2026-09-15T08:00:00Z',
        updated_at: '2026-09-15T08:00:00Z',
      }),
    );

    const result = await firstValueFrom(
      TestBed.inject(TicketsDataAccess).addPublicComment(7, 'Any update?'),
    );

    expect(result.author).toEqual({ id: 9, name: 'Eli Employee' });
    expect(ticketsApi.createTicketComment).toHaveBeenCalledWith(
      7,
      { content: 'Any update?', visibility: CommentVisibility.PUBLIC },
      'body',
      false,
      { transferCache: false },
    );
  });
});
