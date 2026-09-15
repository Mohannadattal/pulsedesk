import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { CategoriesApi } from '../../../api/generated/api/categories.service';
import { TicketsApi } from '../../../api/generated/api/tickets.service';
import { CommentVisibility } from '../../../api/generated/model/commentVisibility';
import { TicketsDataAccess } from './tickets-data-access';

describe('TicketsDataAccess', () => {
  const categoriesApi = { listCategories: vi.fn() };
  const ticketsApi = { createTicketComment: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        TicketsDataAccess,
        { provide: CategoriesApi, useValue: categoriesApi },
        { provide: TicketsApi, useValue: ticketsApi },
      ],
    });
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
